<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Node } from '../skill_tree_types';
  import {
    baseJewelRadius,
    calculateNodePos,
    drawnNodes,
    formatStats,
    inverseTranslations,
    skillTree,
    debugNodeInfo
  } from '../skill_tree';
  import { PixiTree } from '../pixi_tree';
  import { KEYSTONE_DESCRIPTIONS } from '../keystone_descriptions';
  import { calculator, data } from '../types';

  export let clickNode: (node: Node) => void;
  export let circledNode: number | undefined;

  export let selectedJewel: number;
  export let seed: number;
  export let highlighted: number[] = [];
  export let disabled: number[] = [];
  export let highlightJewels = false;

  // Camera state — same offset/scaling semantics as the old Canvas 2D renderer, so the
  // pan/zoom math (and centerOnNode) is unchanged; PixiTree just turns it into a single
  // world-container transform.
  let scaling = 10;
  let offsetX = 0;
  let offsetY = 0;

  let tree: PixiTree | undefined;
  let ready = false;
  let host: HTMLDivElement;

  let width = 0;
  let height = 0;

  let hoveredNode: Node | undefined;
  let mouseX = 0;
  let mouseY = 0;
  let cursor = 'default';
  let fpsText = '';

  const applyTransform = () => {
    tree?.setTransform(offsetX, offsetY, scaling);
  };

  export const centerOnNode = (nodeId: number) => {
    const node = skillTree.nodes[nodeId];
    if (!node || !window) {
      return;
    }
    const pos = calculateNodePos(node, 0, 0, 1);
    offsetX = (window.innerWidth / 2) * scaling - pos.x;
    offsetY = (window.innerHeight / 2) * scaling - pos.y;
    applyTransform();
  };

  // Whether the hovered node is "active" (inside the jewel radius and not disabled) —
  // drives whether the tooltip shows the transformed result for that node.
  const isActive = (node: Node | undefined): boolean => {
    if (!node || circledNode === undefined) {
      return false;
    }
    const c = drawnNodes[circledNode];
    if (!c || disabled.indexOf(node.skill as number) >= 0) {
      return false;
    }
    const cp = calculateNodePos(c, 0, 0, 1);
    const np = calculateNodePos(node, 0, 0, 1);
    return Math.hypot(np.x - cp.x, np.y - cp.y) < baseJewelRadius;
  };

  interface TooltipLine {
    text: string;
    special: boolean;
  }
  let tooltip: { name: string; lines: TooltipLine[] } | undefined;

  // Build the tooltip model for the hovered node (ported from the old canvas tooltip):
  // base stats, or the per-conqueror transformed variant(s) when the node is active.
  const computeTooltip = (node: Node | undefined): { name: string; lines: TooltipLine[] } | undefined => {
    if (!node) {
      return undefined;
    }

    let nodeName = node.name ?? '';
    let nodeStats: TooltipLine[] = (node.stats || []).map((s) => ({ text: s, special: false }));

    if (!node.isJewelSocket && isActive(node)) {
      const passive = node.skill ? data.TreeToPassive[node.skill] : undefined;
      const conquerorMap = selectedJewel ? data.TimelessJewelConquerors[selectedJewel] : undefined;

      if (passive && seed && selectedJewel && conquerorMap) {
        // Conqueror only changes the outcome for keystones — notables and small passives
        // roll off graphID+seed alone. Compute every conqueror, dedupe identical results,
        // and label each distinct variant with the conqueror(s) that produce it.
        type Variant = { name: string; stats: TooltipLine[]; conquerors: string[] };
        const variants: Variant[] = [];

        for (const conqueror of Object.keys(conquerorMap)) {
          const result = calculator.Calculate(passive.Index, seed, selectedJewel, conqueror);
          if (!result) {
            continue;
          }

          let vName = node.name ?? '';
          let vStats: TooltipLine[];

          if ('AlternatePassiveSkill' in result && result.AlternatePassiveSkill) {
            vName = result.AlternatePassiveSkill.Name;
            vStats = [];
            if (node.isKeystone) {
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
            vStats = (node.stats || []).map((s) => ({ text: s, special: false }));
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
          nodeName = variants[0].name;
          nodeStats = variants[0].stats;
        } else if (variants.length > 1) {
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
    } else if (node.isJewelSocket && (node.stats || []).length === 0) {
      nodeStats = [{ text: 'Click to select this socket', special: true }];
    }

    if (debugNodeInfo) {
      const dbg = node as Node & { id?: string; edges?: number[] };
      const flags =
        [node.isKeystone && 'keystone', node.isNotable && 'notable', node.isJewelSocket && 'socket']
          .filter(Boolean)
          .join(', ') || 'small';
      nodeStats = [
        ...nodeStats,
        { text: '', special: false },
        { text: `[debug] skill ${node.skill} · id ${dbg.id ?? '?'}`, special: true },
        {
          text: `group ${node.group} · orbit ${node.orbit} · orbitIndex ${node.orbitIndex} · ${flags}`,
          special: true
        },
        { text: `out: ${(node.out ?? []).join(', ') || '—'}`, special: true },
        { text: `in: ${(node.in ?? []).join(', ') || '—'}`, special: true },
        { text: `edges: ${(dbg.edges ?? []).join(', ') || '—'}`, special: true }
      ];
    }

    return { name: nodeName, lines: nodeStats };
  };

  $: tooltip = computeTooltip(hoveredNode);
  $: cursor = hoveredNode?.isJewelSocket ? 'pointer' : 'default';

  // Push dynamic state into the engine. Highlights are read by the engine's ticker each
  // frame; active states / effect backdrops only recompute when the socket or disabled
  // set changes.
  $: if (tree) {
    tree.highlighted = highlighted;
    tree.highlightJewels = highlightJewels;
  }
  $: if (ready && tree) {
    tree.circledNode = circledNode;
    tree.updateActiveStates(new Set(disabled));
  }

  // --- Pointer / wheel interaction (canvas-space coordinates) -----------------
  let down = false;
  let downX = 0;
  let downY = 0;
  let startX = 0;
  let startY = 0;

  const localPoint = (event: MouseEvent): { x: number; y: number } => {
    const rect = host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent) => {
    const p = localPoint(event);
    down = true;
    downX = p.x;
    downY = p.y;
    startX = offsetX;
    startY = offsetY;
    mouseX = p.x;
    mouseY = p.y;
    if (hoveredNode) {
      clickNode(hoveredNode);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const p = localPoint(event);
    mouseX = p.x;
    mouseY = p.y;
    if (down) {
      offsetX = startX - (downX - p.x) * scaling;
      offsetY = startY - (downY - p.y) * scaling;
      applyTransform();
    }
    hoveredNode = tree?.hitTest(p.x, p.y);
  };

  const onPointerUp = () => {
    down = false;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const p = localPoint(event);
    const newScaling = Math.min(30, Math.max(3, scaling + event.deltaY / 100));
    // Zoom toward the cursor: keep the tree point under the pointer fixed. Offset is in
    // tree units, so the compensation is proportional to the actual change in scaling.
    offsetX += p.x * (newScaling - scaling);
    offsetY += p.y * (newScaling - scaling);
    scaling = newScaling;
    applyTransform();
  };

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    tree?.resize(width, height);
  };

  onMount(() => {
    width = window.innerWidth;
    height = window.innerHeight;

    const engine = new PixiTree();
    let fpsTimer: ReturnType<typeof setInterval> | undefined;

    engine.build(width, height).then(() => {
      tree = engine;
      host.appendChild(engine.canvas);
      engine.canvas.style.touchAction = 'none';

      // Centre the tree on first load (same math as the old renderer).
      offsetX = skillTree.min_x + (window.innerWidth / 2) * scaling;
      offsetY = skillTree.min_y + (window.innerHeight / 2) * scaling;
      engine.circledNode = circledNode;
      engine.highlighted = highlighted;
      engine.highlightJewels = highlightJewels;
      applyTransform();
      engine.updateActiveStates(new Set(disabled));
      ready = true;

      fpsTimer = setInterval(() => {
        fpsText = `${Math.round(engine.fps)} fps`;
      }, 500);
    });

    return () => {
      if (fpsTimer) {
        clearInterval(fpsTimer);
      }
    };
  });

  onDestroy(() => {
    tree?.destroy();
    tree = undefined;
  });
</script>

<svelte:window on:pointerup={onPointerUp} on:resize={resize} />

<div class="tree-root" style="cursor: {cursor}">
  <div
    bind:this={host}
    class="tree-canvas"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:wheel={onWheel}>
  </div>

  {#if tooltip && hoveredNode}
    <div class="tree-tooltip" style="left: {mouseX}px; top: {mouseY}px">
      <div class="tree-tooltip-title">{tooltip.name}</div>
      {#if tooltip.lines.length > 0}
        <div class="tree-tooltip-body">
          {#each tooltip.lines as line}
            <div class="tree-tooltip-line" class:special={line.special}>{line.text || ' '}</div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="tree-fps">{fpsText}</div>

  <slot />
</div>

<style>
  .tree-root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #080c11;
  }

  .tree-canvas {
    position: absolute;
    inset: 0;
    touch-action: none;
  }

  .tree-tooltip {
    position: absolute;
    pointer-events: none;
    min-width: 600px;
    max-width: 600px;
    z-index: 20;
    font-family: 'Roboto Mono', monospace;
  }

  .tree-tooltip-title {
    background: rgba(75, 63, 24, 0.9);
    color: #ffffff;
    text-align: center;
    font-size: 25px;
    line-height: 55px;
    height: 55px;
    overflow: hidden;
    white-space: nowrap;
  }

  .tree-tooltip-body {
    background: rgba(0, 0, 0, 0.8);
    padding: 12px 15px;
  }

  .tree-tooltip-line {
    color: #ffffff;
    font-size: 17px;
    line-height: 22px;
    white-space: pre-wrap;
  }

  .tree-tooltip-line.special {
    color: #8cf34c;
  }

  .tree-fps {
    position: absolute;
    top: 2px;
    right: 6px;
    color: #ffffff;
    font-family: 'Roboto Mono', monospace;
    font-size: 12px;
    pointer-events: none;
    z-index: 20;
  }
</style>
