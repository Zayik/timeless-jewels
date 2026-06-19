<script lang="ts">
  import { Canvas, Layer } from 'svelte-canvas';
  import type { RenderFunc, Node } from '../skill_tree_types';
  import {
    baseJewelRadius,
    calculateNodePos,
    distance,
    drawnGroups,
    drawnNodes,
    formatStats,
    inverseSprites,
    inverseSpritesActive,
    inverseTranslations,
    skillTree,
    spriteDrawScale,
    clipNodeIcons,
    connections,
    debugNodeInfo,
    effectNodes,
    toCanvasCoords
  } from '../skill_tree';
  import type { Point } from '../skill_tree';
  import { KEYSTONE_DESCRIPTIONS } from '../keystone_descriptions';
  import { calculator, data } from '../types';

  export let clickNode: (node: Node) => void;
  export let circledNode: number | undefined;

  export let selectedJewel: number;
  export let seed: number;
  export let highlighted: number[] = [];
  export let disabled: number[] = [];
  export let highlightJewels = false;

  let scaling = 10;
  let offsetX = 0;
  let offsetY = 0;

  export const centerOnNode = (nodeId: number) => {
    const node = skillTree.nodes[nodeId];
    if (!node || !window) {
      return;
    }
    const pos = calculateNodePos(node, 0, 0, 1);
    offsetX = (window.innerWidth / 2) * scaling - pos.x;
    offsetY = (window.innerHeight / 2) * scaling - pos.y;
  };

  const startGroups = [427, 320, 226, 227, 323, 422, 329];

  const titleFont = '25px Roboto Mono';
  const statsFont = '17px Roboto Mono';

  $: jewelRadius = baseJewelRadius / scaling;

  // Per-game sprite draw scale (PoE1 = 2.6; PoE2 raises it). Live-bound from skill_tree.
  $: drawScaling = spriteDrawScale;

  const spriteCache: Record<string, HTMLImageElement> = {};
  const spriteCacheActive: Record<string, HTMLImageElement> = {};
  const drawSprite = (
    context: CanvasRenderingContext2D,
    path: string,
    pos: Point,
    active = false,
    mirrored = false,
    clipCircle = false
  ) => {
    let sprite = active ? inverseSpritesActive[path] : inverseSprites[path];

    if (!sprite && active) {
      sprite = inverseSprites[path];
    }

    // PoE2 lacks some PoE1-named sprites (e.g. PSGroupBackground1/2/3). Skip them
    // rather than crash; the rest of the tree still renders.
    if (!sprite) {
      return;
    }

    const spriteSheetUrl = sprite.filename;

    if (!(spriteSheetUrl in (active ? spriteCacheActive : spriteCache))) {
      (active ? spriteCacheActive : spriteCache)[spriteSheetUrl] = new Image();
      (active ? spriteCacheActive : spriteCache)[spriteSheetUrl].src = spriteSheetUrl;
    }

    const self = sprite.coords[path];

    const newWidth = (self.w / scaling) * drawScaling;
    const newHeight = (self.h / scaling) * drawScaling;

    const topLeftX = pos.x - newWidth / 2;
    const topLeftY = pos.y - newHeight / 2;

    let finalY = topLeftY;

    if (mirrored) {
      finalY = topLeftY - newHeight / 2;
    }

    // PoE2 icons are opaque squares; clip to an inscribed circle so the node
    // reads as a round disc inside its ring frame (matches the official tree).
    if (clipCircle) {
      context.save();
      context.beginPath();
      context.arc(pos.x, pos.y, Math.min(newWidth, newHeight) / 2, 0, Math.PI * 2);
      context.clip();
    }

    context.drawImage(
      (active ? spriteCacheActive : spriteCache)[spriteSheetUrl],
      self.x,
      self.y,
      self.w,
      self.h,
      topLeftX,
      finalY,
      newWidth,
      newHeight
    );

    if (clipCircle) {
      context.restore();
    }

    if (mirrored) {
      context.save();

      context.translate(topLeftX, topLeftY);
      context.rotate(Math.PI);

      context.drawImage(
        (active ? spriteCacheActive : spriteCache)[spriteSheetUrl],
        self.x,
        self.y,
        self.w,
        self.h,
        -newWidth,
        -(newHeight / 2),
        newWidth,
        -newHeight
      );

      context.restore();
    }
  };

  const wrapText = (text: string, context: CanvasRenderingContext2D, width: number): string[] => {
    const result = [];

    let currentWord = '';
    text.split(' ').forEach((word) => {
      if (context.measureText(currentWord + word).width < width) {
        currentWord += ' ' + word;
      } else {
        result.push(currentWord.trim());
        currentWord = word;
      }
    });
    61834;

    if (currentWord.length > 0) {
      result.push(currentWord.trim());
    }

    return result;
  };

  let mousePos: Point = {
    x: Number.MIN_VALUE,
    y: Number.MIN_VALUE
  };

  let cursor = 'unset';

  let hoveredNode: Node | undefined;
  const render: RenderFunc = ({ context, width, height, time }) => {
    const start = window.performance.now();

    // Convert time (ms) to a slow-rotating hue for highlight animation.
    // When nothing is highlighted, stay at hue 0 (no visible pulsing).
    const slowTime = (highlighted && highlighted.length > 0) || highlightJewels ? Math.round(time / 40) : 0;

    context.clearRect(0, 0, width, height);

    context.fillStyle = '#080c11';
    context.fillRect(0, 0, width, height);

    const connected = {};
    Object.keys(drawnGroups).forEach((groupId) => {
      const group = drawnGroups[groupId];
      const groupPos = toCanvasCoords(group.x, group.y, offsetX, offsetY, scaling);

      const maxOrbit = Math.max(...group.orbits);
      if (startGroups.indexOf(parseInt(groupId)) >= 0) {
        // Do not draw starter nodes
      } else if (maxOrbit == 1) {
        drawSprite(context, 'PSGroupBackground1', groupPos, false);
      } else if (maxOrbit == 2) {
        drawSprite(context, 'PSGroupBackground2', groupPos, false);
      } else if (maxOrbit == 3 || group.orbits.length > 1) {
        drawSprite(context, 'PSGroupBackground3', groupPos, false, true);
        // drawMirror(context, $PSGroupBackground3, groupPos);
      }
    });

    // Effect backdrops (PoE2): the radial mastery/notable patterns, drawn behind
    // everything. These are glow/light graphics (disabled art is dark, ~lum 18), so
    // they're composited ADDITIVELY — otherwise they're invisible on the dark bg.
    // A backdrop shows its LIT graphic when at least one of its governing notables
    // is inside the jewel radius and still enabled, and its DIM graphic when every
    // governing notable is disabled (or out of radius). So a mastery dims only once
    // all the notables it serves are disabled; a notable's own backdrop dims as soon
    // as that notable is disabled.
    if (effectNodes.length > 0) {
      const radiusCentre =
        circledNode && drawnNodes[circledNode]
          ? calculateNodePos(drawnNodes[circledNode], offsetX, offsetY, scaling)
          : undefined;
      const prevComposite = context.globalCompositeOperation;
      context.globalCompositeOperation = 'lighter';
      effectNodes.forEach((e) => {
        const m = e.node;
        if (!m.activeEffectImage) {
          return;
        }
        const mp = calculateNodePos(m, offsetX, offsetY, scaling);
        let active = false;
        if (radiusCentre) {
          for (const skill of e.notableSkills) {
            if (disabled.indexOf(skill) >= 0) {
              continue;
            }
            const governing = drawnNodes[skill];
            if (!governing) {
              continue;
            }
            const gp = calculateNodePos(governing, offsetX, offsetY, scaling);
            if (distance(gp, radiusCentre) < jewelRadius) {
              active = true;
              break;
            }
          }
        }
        drawSprite(context, m.activeEffectImage, mp, active);
      });
      context.globalCompositeOperation = prevComposite;
    }

    // Draw one connector between nodes a and b. When (cx,cy) is given the connector
    // follows the arc of the circle centred there (radius = distance to a node,
    // endpoints by angle, minor arc); otherwise it's a straight line.
    const drawConnector = (a: Node, b: Node, cx?: number, cy?: number) => {
      const pa = calculateNodePos(a, offsetX, offsetY, scaling);
      const pb = calculateNodePos(b, offsetX, offsetY, scaling);
      context.beginPath();
      if (cx !== undefined && cy !== undefined) {
        const cpos = toCanvasCoords(cx, cy, offsetX, offsetY, scaling);
        const radius = distance(cpos, pa);
        const startA = Math.atan2(pa.y - cpos.y, pa.x - cpos.x);
        const endA = Math.atan2(pb.y - cpos.y, pb.x - cpos.x);
        const delta = Math.atan2(Math.sin(endA - startA), Math.cos(endA - startA));
        if (radius < 1) {
          context.moveTo(pa.x, pa.y);
          context.lineTo(pb.x, pb.y);
        } else {
          context.arc(cpos.x, cpos.y, radius, startA, startA + delta, delta < 0);
        }
      } else {
        context.moveTo(pa.x, pa.y);
        context.lineTo(pb.x, pb.y);
      }
      context.lineWidth = 6 / scaling;
      context.strokeStyle = `#524518`;
      context.stroke();
    };

    if (connections.length > 0) {
      // PoE2: the export's edge list says, per connection, whether it arcs and the
      // arc centre (orbitX/orbitY) — arcs routinely cross groups, so this can't be
      // re-derived from the two nodes' group/orbit.
      connections.forEach((c) => {
        const a = drawnNodes[c.from];
        const b = drawnNodes[c.to];
        if (a && b) {
          drawConnector(a, b, c.cx, c.cy);
        }
      });
    } else {
      // PoE1: same group + same orbit → arc around the group centre, else line.
      Object.keys(drawnNodes).forEach((nodeId) => {
        const node = drawnNodes[nodeId];
        node.out?.forEach((o) => {
          const targetNode = drawnNodes[parseInt(o)];
          if (!targetNode || targetNode.isMastery) {
            return;
          }
          const min = Math.min(parseInt(o), parseInt(nodeId));
          const max = Math.max(parseInt(o), parseInt(nodeId));
          const joined = min + ':' + max;
          if (joined in connected) {
            return;
          }
          connected[joined] = true;

          const group =
            node.group !== undefined &&
            node.group === targetNode.group &&
            node.orbit !== undefined &&
            node.orbit === targetNode.orbit
              ? drawnGroups[node.group]
              : undefined;
          drawConnector(node, targetNode, group?.x, group?.y);
        });
      });
    }

    let circledNodePos: Point | undefined;
    if (circledNode && drawnNodes[circledNode]) {
      circledNodePos = calculateNodePos(drawnNodes[circledNode], offsetX, offsetY, scaling);
      context.strokeStyle = '#ad2b2b';
    }

    let hoveredNodeActive = false;
    let newHoverNode: Node | undefined;
    Object.keys(drawnNodes).forEach((nodeId) => {
      const node = drawnNodes[nodeId];
      const rotatedPos = calculateNodePos(node, offsetX, offsetY, scaling);
      let touchDistance = 0;

      let active = false;
      if (circledNodePos) {
        if (distance(rotatedPos, circledNodePos) < jewelRadius) {
          active = true;
        }
      }

      if (disabled.indexOf(node.skill) >= 0) {
        active = false;
      }

      if (node.isKeystone) {
        touchDistance = 110;
        drawSprite(context, node.icon, rotatedPos, active, false, clipNodeIcons);
        if (active) {
          drawSprite(context, 'KeystoneFrameAllocated', rotatedPos, false);
        } else {
          drawSprite(context, 'KeystoneFrameUnallocated', rotatedPos, false);
        }
      } else if (node.isNotable) {
        touchDistance = 70;
        drawSprite(context, node.icon, rotatedPos, active, false, clipNodeIcons);
        if (active) {
          drawSprite(context, 'NotableFrameAllocated', rotatedPos, false);
        } else {
          drawSprite(context, 'NotableFrameUnallocated', rotatedPos, false);
        }
      } else if (node.isJewelSocket) {
        touchDistance = 70;
        if (node.expansionJewel) {
          if (active) {
            drawSprite(context, 'JewelSocketAltNormal', rotatedPos, false);
          } else {
            drawSprite(context, 'JewelSocketAltNormal', rotatedPos, false);
          }
        } else {
          if (active) {
            drawSprite(context, 'JewelFrameAllocated', rotatedPos, false);
          } else {
            drawSprite(context, 'JewelFrameUnallocated', rotatedPos, false);
          }
        }
      } else if (node.isMastery) {
        drawSprite(context, node.inactiveIcon, rotatedPos, active, false, clipNodeIcons);
      } else {
        touchDistance = 50;
        drawSprite(context, node.icon, rotatedPos, active, false, clipNodeIcons);
        if (active) {
          drawSprite(context, 'PSSkillFrameActive', rotatedPos, false);
        } else {
          drawSprite(context, 'PSSkillFrame', rotatedPos, false);
        }
      }

      if (highlighted.indexOf(node.skill) >= 0 || (highlightJewels && node.isJewelSocket)) {
        context.strokeStyle = `hsl(${slowTime}, 100%, 50%)`;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(rotatedPos.x, rotatedPos.y, (touchDistance + 30) / scaling, 0, Math.PI * 2);
        context.stroke();
      }

      if (distance(rotatedPos, mousePos) < touchDistance / scaling) {
        newHoverNode = node;
        hoveredNodeActive = active;
      }
    });

    hoveredNode = newHoverNode;

    if (circledNodePos) {
      context.strokeStyle = '#ad2b2b';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(circledNodePos.x, circledNodePos.y, jewelRadius, 0, Math.PI * 2);
      context.stroke();
    }

    if (hoveredNode) {
      let nodeName = hoveredNode.name;
      let nodeStats: { text: string; special: boolean }[] = (hoveredNode.stats || []).map((s) => ({
        text: s,
        special: false
      }));

      if (!hoveredNode.isJewelSocket && hoveredNodeActive) {
        const passive = hoveredNode.skill ? data.TreeToPassive[hoveredNode.skill] : undefined;
        const conquerorMap = selectedJewel ? data.TimelessJewelConquerors[selectedJewel] : undefined;

        if (passive && seed && selectedJewel && conquerorMap) {
          // Conqueror only changes the outcome for keystones — notables and small
          // passives roll off graphID+seed alone. So compute every conqueror,
          // dedupe identical results, and label each distinct variant with the
          // conqueror(s) that produce it. Non-keystones collapse to one variant.
          type Variant = { name: string; stats: { text: string; special: boolean }[]; conquerors: string[] };
          const variants: Variant[] = [];

          for (const conqueror of Object.keys(conquerorMap)) {
            const result = calculator.Calculate(passive.Index, seed, selectedJewel, conqueror);
            if (!result) {
              continue;
            }

            let vName = hoveredNode.name;
            let vStats: { text: string; special: boolean }[];

            if ('AlternatePassiveSkill' in result && result.AlternatePassiveSkill) {
              // Replacement: the node becomes a different skill entirely.
              vName = result.AlternatePassiveSkill.Name;
              vStats = [];
              if (hoveredNode.isKeystone) {
                // Keystone replacements carry only a name-marker stat, so the
                // translated stat just repeats the keystone name. Use the real
                // effect text from the curated keystone map instead.
                vStats = (KEYSTONE_DESCRIPTIONS[vName] ?? []).map((s) => ({ text: s, special: true }));
              } else if ('StatsKeys' in result.AlternatePassiveSkill) {
                result.AlternatePassiveSkill.StatsKeys.forEach((statId, i) => {
                  const stat = data.GetStatByIndex(statId);
                  const translation = inverseTranslations[stat.ID] || '';
                  if (translation) {
                    vStats.push({ text: formatStats(translation, result.StatRolls[i]) || stat.ID, special: true });
                  }
                });
              }
            } else {
              // Augment: the node keeps its base stats and gains additions.
              vStats = (hoveredNode.stats || []).map((s) => ({ text: s, special: false }));
            }

            if (result.AlternatePassiveAdditionInformations) {
              result.AlternatePassiveAdditionInformations.forEach((info) => {
                if ('StatsKeys' in info.AlternatePassiveAddition) {
                  info.AlternatePassiveAddition.StatsKeys.forEach((statId, i) => {
                    const stat = data.GetStatByIndex(statId);
                    const translation = inverseTranslations[stat.ID] || '';
                    if (translation) {
                      vStats.push({ text: formatStats(translation, info.StatRolls[i]) || stat.ID, special: true });
                    }
                  });
                }
              });
            }

            const key = vName + '|' + vStats.map((s) => s.text).join('|');
            const existing = variants.find((v) => v.name + '|' + v.stats.map((s) => s.text).join('|') === key);
            if (existing) {
              existing.conquerors.push(conqueror);
            } else {
              variants.push({ name: vName, stats: vStats, conquerors: [conqueror] });
            }
          }

          if (variants.length === 1) {
            // Identical across all conquerors — show it plainly.
            nodeName = variants[0].name;
            nodeStats = variants[0].stats;
          } else if (variants.length > 1) {
            // Distinct per conqueror (keystone) — keep the base node name as the
            // title and list each variant under the conqueror(s) that yield it.
            nodeStats = [];
            variants.forEach((v, idx) => {
              if (idx > 0) {
                nodeStats.push({ text: '', special: false });
              }
              nodeStats.push({ text: v.conquerors.join(', ') + ' → ' + v.name, special: true });
              v.stats.forEach((s) => nodeStats.push(s));
            });
          }
        }
      }

      if (debugNodeInfo) {
        // Raw node data for debugging the PoE2 tree (id, group, orbit, links, …).
        const dbg = hoveredNode as Node & { id?: string; edges?: number[] };
        const flags =
          [
            hoveredNode.isKeystone && 'keystone',
            hoveredNode.isNotable && 'notable',
            hoveredNode.isJewelSocket && 'socket'
          ]
            .filter(Boolean)
            .join(', ') || 'small';
        nodeStats = [
          ...nodeStats,
          { text: '', special: false },
          { text: `[debug] skill ${hoveredNode.skill} · id ${dbg.id ?? '?'}`, special: true },
          {
            text: `group ${hoveredNode.group} · orbit ${hoveredNode.orbit} · orbitIndex ${hoveredNode.orbitIndex} · ${flags}`,
            special: true
          },
          { text: `out: ${(hoveredNode.out ?? []).join(', ') || '—'}`, special: true },
          { text: `in: ${(hoveredNode.in ?? []).join(', ') || '—'}`, special: true },
          { text: `edges: ${(dbg.edges ?? []).join(', ') || '—'}`, special: true }
        ];
      }

      context.font = titleFont;
      const textMetrics = context.measureText(nodeName);

      const maxWidth = Math.max(textMetrics.width + 50, 600);

      context.font = statsFont;

      const allLines: {
        text: string;
        offset: number;
        special: boolean;
      }[] = [];

      const padding = 30;

      let offset = 85;

      if (nodeStats && nodeStats.length > 0) {
        nodeStats.forEach((stat) => {
          if (allLines.length > 0) {
            offset += 5;
          }

          stat.text.split('\n').forEach((line) => {
            if (allLines.length > 0) {
              offset += 10;
            }

            const lines = wrapText(line, context, maxWidth - padding);
            lines.forEach((l) => {
              allLines.push({
                text: l,
                offset,
                special: stat.special
              });
              offset += 20;
            });
          });
        });
      } else if (hoveredNode.isJewelSocket) {
        allLines.push({
          text: 'Click to select this socket',
          offset,
          special: true
        });

        offset += 20;
      }

      const titleHeight = 55;

      context.fillStyle = 'rgba(75,63,24,0.9)';
      context.fillRect(mousePos.x, mousePos.y, maxWidth, titleHeight);

      context.fillStyle = '#ffffff';
      context.font = titleFont;
      context.textAlign = 'center';
      context.fillText(nodeName, mousePos.x + maxWidth / 2, mousePos.y + 35);

      context.fillStyle = 'rgba(0,0,0,0.8)';
      context.fillRect(mousePos.x, mousePos.y + titleHeight, maxWidth, offset - titleHeight);

      context.font = statsFont;
      context.textAlign = 'left';
      allLines.forEach((l) => {
        if (l.special) {
          context.fillStyle = '#8cf34c';
        } else {
          context.fillStyle = '#ffffff';
        }

        context.fillText(l.text, mousePos.x + padding / 2, mousePos.y + l.offset);
      });
    }

    if (hoveredNode && hoveredNode.isJewelSocket) {
      cursor = 'pointer';
    } else {
      cursor = 'unset';
    }

    context.fillStyle = '#ffffff';
    context.textAlign = 'right';
    context.font = '12px Roboto Mono';

    const end = window.performance.now();

    context.fillText(`${(end - start).toFixed(1)}ms`, width - 5, 17);
  };

  let downX = 0;
  let downY = 0;

  let startX = 0;
  let startY = 0;

  let down = false;
  const mouseDown = (event: MouseEvent) => {
    down = true;
    downX = event.offsetX;
    downY = event.offsetY;
    startX = offsetX;
    startY = offsetY;

    mousePos = {
      x: event.offsetX,
      y: event.offsetY
    };

    if (hoveredNode) {
      clickNode(hoveredNode);
    }
  };

  const mouseUp = (event: PointerEvent) => {
    if (event.type === 'pointerup') {
      down = false;
    }

    mousePos = {
      x: event.offsetX,
      y: event.offsetY
    };
  };

  const mouseMove = (event: MouseEvent) => {
    if (down) {
      offsetX = startX - (downX - event.offsetX) * scaling;
      offsetY = startY - (downY - event.offsetY) * scaling;
    }

    mousePos = {
      x: event.offsetX,
      y: event.offsetY
    };
  };

  const onScroll = (event: WheelEvent) => {
    const newScaling = Math.min(30, Math.max(3, scaling + event.deltaY / 100));

    // Zoom toward the cursor: keep the tree point under the pointer fixed.
    // `offset` is in tree units (see toCanvasCoords), so the compensation must be
    // proportional to the ACTUAL change in `scaling`. The old code added the full
    // cursor offset assuming a fixed ±1 step per scroll, which glitched the view
    // across the screen for trackpads / high-resolution wheels (deltaY ≠ ±100).
    offsetX += event.offsetX * (newScaling - scaling);
    offsetY += event.offsetY * (newScaling - scaling);
    scaling = newScaling;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  let width = 0;
  let height = 0;
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
  };

  let initialized = false;
  $: {
    if (!initialized && skillTree) {
      initialized = true;
      offsetX = skillTree.min_x + (window.innerWidth / 2) * scaling;
      offsetY = skillTree.min_y + (window.innerHeight / 2) * scaling;
    }
    resize();
  }
</script>

<svelte:window on:pointerup={mouseUp} on:pointermove={mouseMove} on:resize={resize} />

{#if width && height}
  <div on:resize={resize} style="touch-action: none; cursor: {cursor}">
    <Canvas {width} {height} autoplay onpointerdown={mouseDown} onwheel={onScroll}>
      <Layer {render} />
    </Canvas>
    <slot />
  </div>
{/if}
