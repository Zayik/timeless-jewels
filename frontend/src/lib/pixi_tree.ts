// WebGL renderer for the passive tree, built on PixiJS v8 (WebGL backend).
//
// Why this exists: the old Canvas 2D renderer redrew every node as two `drawImage`
// calls every frame (~6800 calls, 33–51ms/frame) and stuttered on pan/zoom. The tree
// is STATIC — only the camera moves — so this engine uploads each node once as a
// batched Sprite and pans/zooms by transforming a single `world` Container. Thousands
// of sprites collapse into a handful of GPU draw calls (the technique poeplanner uses).
//
// The Svelte component (SkillTree.svelte) owns props/events and drives this class:
// build() once, then setTransform() on pan/zoom, updateActiveStates() when the jewel
// socket / disabled set changes, and hitTest() for hover/click. Tooltips are HTML.

import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer
} from 'pixi.js';
import {
  baseJewelRadius,
  calculateNodePos,
  clipNodeIcons,
  connectionList,
  drawnGroupList,
  drawnNodes,
  drawnNodesList,
  effectNodes,
  inverseSprites,
  inverseSpritesActive,
  masteryEffectScale,
  notableDrawScale,
  skillTree,
  socketDrawScale,
  spriteDrawScale,
  type Point
} from './skill_tree';
import { POE2_SOCKET_FRAME_ALLOCATED, POE2_SOCKET_FRAME_UNALLOCATED } from './poe2/skill_tree_adapter';
import type { Node } from './skill_tree_types';

const BG_COLOR = 0x080c11;
const CONNECTOR_COLOR = 0x524518;
const CONNECTOR_WORLD_WIDTH = 6;
const JEWEL_CIRCLE_COLOR = 0xad2b2b;
const STARTER_GROUPS = [427, 320, 226, 227, 323, 422, 329];

// hsl(h,1,0.5) → 0xRRGGBB, matching the old `hsl(${hue},100%,50%)` highlight colour.
const hslToHex = (h: number, s: number, l: number): number => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
};

// One node's renderable parts. `active` is cached so updateActiveStates only swaps
// textures when the state actually flips.
interface NodeVisual {
  node: Node;
  base: Point;
  icon?: Sprite;
  frame?: Sprite;
  touchDistance: number;
  active: boolean;
}

interface EffectVisual {
  sprite: Sprite;
  base: Point;
  notableSkills: number[];
  image: string;
  active: boolean;
}

// Resolve the sheet + sub-rect for a sprite path, mirroring the old drawSprite fallback
// (active variant falls back to the inactive sheet when the active one lacks the path).
const resolveRect = (path: string, active: boolean): { filename: string; rect: Rectangle } | undefined => {
  let sheet = active ? inverseSpritesActive[path] : inverseSprites[path];
  if (!sheet && active) {
    sheet = inverseSprites[path];
  }
  if (!sheet) {
    return undefined;
  }
  const c = sheet.coords[path];
  if (!c) {
    return undefined;
  }
  return { filename: sheet.filename, rect: new Rectangle(c.x, c.y, c.w, c.h) };
};

export class PixiTree {
  private app!: Application;
  private world!: Container;
  private overlay!: Graphics;
  private nodeVisuals: NodeVisual[] = [];
  private effectVisuals: EffectVisual[] = [];

  // Texture caches.
  private baseTextures: Record<string, Texture> = {};
  private subCache = new Map<string, Texture | undefined>();
  private maskedCache = new Map<string, Texture | undefined>();

  // Per-game constants captured at build time (the active loader sets these before the
  // component mounts; they don't change during a component's lifetime).
  private readonly drawScale = spriteDrawScale;
  private readonly notableScale = notableDrawScale;
  private readonly masteryScale = masteryEffectScale;
  private readonly socketScale = socketDrawScale;
  private readonly clip = clipNodeIcons;
  // True when the PoE2 empty-socket frames are loaded (so jewel sockets use them instead
  // of PoE1's generic frame).
  private readonly hasSocketFrames = !!inverseSprites[POE2_SOCKET_FRAME_UNALLOCATED];
  private readonly absX = Math.abs(skillTree.min_x);
  private readonly absY = Math.abs(skillTree.min_y);

  // Dynamic state the component pushes in; the ticker reads these each frame.
  public highlighted: number[] = [];
  public highlightJewels = false;
  public circledNode: number | undefined;
  private scaling = 10;
  private hue = 0;

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get fps(): number {
    return this.app.ticker.FPS;
  }

  async build(width: number, height: number): Promise<void> {
    this.app = new Application();
    await this.app.init({
      width,
      height,
      backgroundColor: BG_COLOR,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl'
    });

    await this.preloadSheets();

    this.world = new Container();
    this.app.stage.addChild(this.world);

    this.buildBackgrounds();
    this.buildConnectors();
    this.buildEffects();
    this.buildNodes();

    this.overlay = new Graphics();
    this.world.addChild(this.overlay);

    this.app.ticker.add(this.tick);
  }

  private async preloadSheets(): Promise<void> {
    const urls = new Set<string>();
    for (const map of [inverseSprites, inverseSpritesActive]) {
      for (const key of Object.keys(map)) {
        urls.add(map[key].filename);
      }
    }
    await Promise.all(
      [...urls].map(async (url) => {
        try {
          this.baseTextures[url] = await Assets.load({ src: url, parser: 'loadTextures' });
        } catch {
          // A missing/blocked sheet just means those sprites skip — the rest still draws.
        }
      })
    );
  }

  // Plain sub-texture into a sheet. Sprites sharing a sheet batch together, so PoE1's
  // handful of sheets yields a handful of draw calls.
  private getTexture(path: string, active: boolean): Texture | undefined {
    const key = (active ? 'a:' : 'i:') + path;
    if (this.subCache.has(key)) {
      return this.subCache.get(key);
    }
    const r = resolveRect(path, active);
    const base = r && this.baseTextures[r.filename];
    const tex = base ? new Texture({ source: base.source, frame: r!.rect }) : undefined;
    this.subCache.set(key, tex);
    return tex;
  }

  // PoE2 icons are opaque squares; bake a circle-masked copy once so the node reads as a
  // round disc inside its ring (PoE1 icons are transparent glyphs and skip this).
  private getMaskedTexture(path: string, active: boolean): Texture | undefined {
    const key = (active ? 'a:' : 'i:') + path;
    if (this.maskedCache.has(key)) {
      return this.maskedCache.get(key);
    }
    const base = this.getTexture(path, active);
    if (!base) {
      this.maskedCache.set(key, undefined);
      return undefined;
    }
    const w = base.frame.width;
    const h = base.frame.height;
    const rt = RenderTexture.create({ width: w, height: h, resolution: 2 });
    const spr = new Sprite(base);
    const mask = new Graphics().circle(w / 2, h / 2, Math.min(w, h) / 2).fill(0xffffff);
    spr.mask = mask;
    const holder = new Container();
    holder.addChild(spr, mask);
    (this.app.renderer as Renderer).render({ container: holder, target: rt });
    holder.destroy({ children: true });
    this.maskedCache.set(key, rt);
    return rt;
  }

  private iconTexture(path: string, active: boolean): Texture | undefined {
    return this.clip ? this.getMaskedTexture(path, active) : this.getTexture(path, active);
  }

  // A centered sprite at a world position, scaled so its on-screen size matches the old
  // renderer (sprite world size = rect * drawScale * mult; the world container's 1/scaling
  // scale then reproduces the old rect/scaling*drawScale screen size).
  private makeSprite(texture: Texture, base: Point, mult = 1): Sprite {
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.position.set(base.x, base.y);
    s.scale.set(this.drawScale * mult);
    return s;
  }

  private buildBackgrounds(): void {
    const layer = new Container();
    drawnGroupList.forEach(({ id, group }) => {
      if (STARTER_GROUPS.indexOf(id) >= 0) {
        return;
      }
      const base: Point = { x: this.absX + group.x, y: this.absY + group.y };
      const maxOrbit = Math.max(...group.orbits);
      if (maxOrbit === 1) {
        this.addBackground(layer, 'PSGroupBackground1', base, false);
      } else if (maxOrbit === 2) {
        this.addBackground(layer, 'PSGroupBackground2', base, false);
      } else if (maxOrbit === 3 || group.orbits.length > 1) {
        this.addBackground(layer, 'PSGroupBackground3', base, true);
      }
    });
    this.world.addChild(layer);
  }

  private addBackground(layer: Container, path: string, base: Point, mirrored: boolean): void {
    const tex = this.getTexture(path, false);
    if (!tex) {
      return;
    }
    if (!mirrored) {
      layer.addChild(this.makeSprite(tex, base));
      return;
    }
    // PSGroupBackground3 is a half-circle sheet; mirror it vertically to form the full
    // circular backdrop (top half + flipped bottom half), both anchored at the centre.
    const top = new Sprite(tex);
    top.anchor.set(0.5, 1);
    top.position.set(base.x, base.y);
    top.scale.set(this.drawScale);
    const bottom = new Sprite(tex);
    bottom.anchor.set(0.5, 1);
    bottom.position.set(base.x, base.y);
    bottom.scale.set(this.drawScale, -this.drawScale);
    layer.addChild(top, bottom);
  }

  private buildConnectors(): void {
    const g = new Graphics();
    connectionList.forEach((c) => {
      const a = drawnNodes[c.from];
      const b = drawnNodes[c.to];
      if (!a || !b) {
        return;
      }
      const pa = calculateNodePos(a, 0, 0, 1);
      const pb = calculateNodePos(b, 0, 0, 1);
      if (c.cx !== undefined && c.cy !== undefined) {
        const cx = this.absX + c.cx;
        const cy = this.absY + c.cy;
        const radius = Math.hypot(pa.x - cx, pa.y - cy);
        if (radius < 1) {
          g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y);
        } else {
          const startA = Math.atan2(pa.y - cy, pa.x - cx);
          const endA = Math.atan2(pb.y - cy, pb.x - cx);
          const delta = Math.atan2(Math.sin(endA - startA), Math.cos(endA - startA));
          g.moveTo(pa.x, pa.y).arc(cx, cy, radius, startA, startA + delta, delta < 0);
        }
      } else {
        g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y);
      }
    });
    g.stroke({ width: CONNECTOR_WORLD_WIDTH, color: CONNECTOR_COLOR });
    this.world.addChild(g);
  }

  private buildEffects(): void {
    if (effectNodes.length === 0) {
      return;
    }
    const layer = new Container();
    effectNodes.forEach((e) => {
      const node = e.node;
      if (!node.activeEffectImage) {
        return;
      }
      const tex = this.getTexture(node.activeEffectImage, false);
      if (!tex) {
        return;
      }
      const base = calculateNodePos(node, 0, 0, 1);
      const sprite = this.makeSprite(tex, base, node.isMastery ? this.masteryScale : 1);
      sprite.blendMode = 'add';
      layer.addChild(sprite);
      this.effectVisuals.push({
        sprite,
        base,
        notableSkills: e.notableSkills,
        image: node.activeEffectImage,
        active: false
      });
    });
    this.world.addChild(layer);
  }

  private buildNodes(): void {
    const layer = new Container();
    drawnNodesList.forEach((node) => {
      const base = calculateNodePos(node, 0, 0, 1);
      const nv: NodeVisual = { node, base, touchDistance: 50, active: false };

      if (node.isJewelSocket) {
        nv.touchDistance = 70;
        nv.frame = this.addFrame(layer, node, base, false);
      } else if (node.isMastery) {
        nv.icon = this.addIcon(layer, node.inactiveIcon, base, false, 1);
      } else if (node.isKeystone) {
        nv.touchDistance = 110;
        nv.icon = this.addIcon(layer, node.icon, base, false, 1);
        nv.frame = this.addFrame(layer, node, base, false);
      } else if (node.isNotable) {
        nv.touchDistance = 70;
        nv.icon = this.addIcon(layer, node.icon, base, false, this.notableScale);
        nv.frame = this.addFrame(layer, node, base, false);
      } else {
        nv.icon = this.addIcon(layer, node.icon, base, false, 1);
        nv.frame = this.addFrame(layer, node, base, false);
      }

      this.nodeVisuals.push(nv);
    });
    this.world.addChild(layer);
  }

  private addIcon(
    layer: Container,
    path: string | undefined,
    base: Point,
    active: boolean,
    mult: number
  ): Sprite | undefined {
    if (!path) {
      return undefined;
    }
    const tex = this.iconTexture(path, active);
    if (!tex) {
      return undefined;
    }
    const s = this.makeSprite(tex, base, mult);
    layer.addChild(s);
    return s;
  }

  private framePath(node: Node, active: boolean): string {
    if (node.isJewelSocket) {
      // PoE2: the empty-socket frame — gold when this socket is the selected one.
      if (this.hasSocketFrames) {
        return active ? POE2_SOCKET_FRAME_ALLOCATED : POE2_SOCKET_FRAME_UNALLOCATED;
      }
      // PoE1 fallback: generic jewel frame.
      return node.expansionJewel ? 'JewelSocketAltNormal' : active ? 'JewelFrameAllocated' : 'JewelFrameUnallocated';
    }
    if (node.isKeystone) {
      return active ? 'KeystoneFrameAllocated' : 'KeystoneFrameUnallocated';
    }
    if (node.isNotable) {
      return active ? 'NotableFrameAllocated' : 'NotableFrameUnallocated';
    }
    return active ? 'PSSkillFrameActive' : 'PSSkillFrame';
  }

  // Scale multiplier for a node's frame sprite. Notables and the PoE2 empty-socket frame
  // each have their own tuning; everything else draws at the global scale.
  private frameMult(node: Node): number {
    if (node.isNotable) {
      return this.notableScale;
    }
    if (node.isJewelSocket && this.hasSocketFrames) {
      return this.socketScale;
    }
    return 1;
  }

  private addFrame(layer: Container, node: Node, base: Point, active: boolean): Sprite | undefined {
    const tex = this.getTexture(this.framePath(node, active), false);
    if (!tex) {
      return undefined;
    }
    const s = this.makeSprite(tex, base, this.frameMult(node));
    layer.addChild(s);
    return s;
  }

  // Swap a node's icon/frame textures to match its active (in-radius + enabled) state.
  private applyState(nv: NodeVisual, active: boolean): void {
    const node = nv.node;
    if (nv.icon) {
      const path = node.isMastery ? node.inactiveIcon : node.icon;
      if (path) {
        const tex = this.iconTexture(path, active);
        if (tex) {
          nv.icon.texture = tex;
        }
      }
    }
    // Swap the frame for everything except PoE1 jewel sockets (those keep a static
    // frame). PoE2 sockets DO swap — the selected socket turns gold.
    if (nv.frame && (!node.isJewelSocket || this.hasSocketFrames)) {
      const tex = this.getTexture(this.framePath(node, active), false);
      if (tex) {
        nv.frame.texture = tex;
      }
    }
    nv.active = active;
  }

  // Recompute active node states + lit/dim effect backdrops. O(n) but only runs when the
  // jewel socket or disabled set changes — never per frame.
  updateActiveStates(disabled: Set<number>): void {
    const circle = this.circledNode !== undefined ? drawnNodes[this.circledNode] : undefined;
    const centre = circle ? calculateNodePos(circle, 0, 0, 1) : undefined;

    for (const nv of this.nodeVisuals) {
      let active = false;
      if (nv.node.isJewelSocket) {
        // A socket is "active" only when it is the selected socket (→ gold frame), not
        // by the radius test (which would also light nearby sockets in the centre cluster).
        active = this.circledNode !== undefined && nv.node.skill === this.circledNode;
      } else if (centre) {
        active = Math.hypot(nv.base.x - centre.x, nv.base.y - centre.y) < baseJewelRadius;
      }
      if (disabled.has(nv.node.skill as number)) {
        active = false;
      }
      if (active !== nv.active) {
        this.applyState(nv, active);
      }
    }

    for (const ev of this.effectVisuals) {
      let active = false;
      if (centre) {
        for (const skill of ev.notableSkills) {
          if (disabled.has(skill)) {
            continue;
          }
          const governing = drawnNodes[skill];
          if (!governing) {
            continue;
          }
          const gp = calculateNodePos(governing, 0, 0, 1);
          if (Math.hypot(gp.x - centre.x, gp.y - centre.y) < baseJewelRadius) {
            active = true;
            break;
          }
        }
      }
      if (active !== ev.active) {
        const tex = this.getTexture(ev.image, active);
        if (tex) {
          ev.sprite.texture = tex;
        }
        ev.active = active;
      }
    }
  }

  // Pan/zoom is just a transform on the world container — the heart of the speedup.
  // Uses the same offset/scaling equations as the old renderer so behaviour is identical.
  setTransform(offsetX: number, offsetY: number, scaling: number): void {
    this.scaling = scaling;
    const s = 1 / scaling;
    this.world.scale.set(s);
    this.world.position.set(offsetX * s, offsetY * s);
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
  }

  // Convert a canvas-space point to world (tree) coordinates for hit-testing.
  toWorld(screenX: number, screenY: number): Point {
    return {
      x: screenX * this.scaling - this.world.position.x * this.scaling,
      y: screenY * this.scaling - this.world.position.y * this.scaling
    };
  }

  hitTest(screenX: number, screenY: number): Node | undefined {
    const w = this.toWorld(screenX, screenY);
    let found: Node | undefined;
    for (const nv of this.nodeVisuals) {
      if (Math.hypot(nv.base.x - w.x, nv.base.y - w.y) < nv.touchDistance) {
        found = nv.node;
      }
    }
    return found;
  }

  // Redraw the dynamic overlay each frame: animated highlight rings + the jewel radius
  // circle. Cheap — only a handful of shapes — and keeps line widths constant on screen.
  private tick = (): void => {
    const animating = (this.highlighted && this.highlighted.length > 0) || this.highlightJewels;
    // Match the old renderer's ~1 hue-degree per 40ms cycle.
    this.hue = animating ? (this.hue + this.app.ticker.deltaMS / 40) % 360 : 0;

    const g = this.overlay;
    g.clear();

    // Jewel radius circle around the focused socket.
    if (this.circledNode !== undefined) {
      const node = drawnNodes[this.circledNode];
      if (node) {
        const p = calculateNodePos(node, 0, 0, 1);
        g.circle(p.x, p.y, baseJewelRadius).stroke({ width: this.scaling, color: JEWEL_CIRCLE_COLOR });
      }
    }

    // Highlight rings. Line width is scaled by `scaling` so it stays ~3px on screen.
    const ringColor = hslToHex(this.hue, 1, 0.5);
    const ringWidth = 3 * this.scaling;
    const drawRing = (node: Node, touch: number) => {
      const p = calculateNodePos(node, 0, 0, 1);
      g.circle(p.x, p.y, touch + 30).stroke({ width: ringWidth, color: ringColor });
    };

    if (this.highlighted) {
      for (const skill of this.highlighted) {
        const node = drawnNodes[skill];
        if (node) {
          drawRing(node, this.touchOf(node));
        }
      }
    }
    if (this.highlightJewels) {
      for (const nv of this.nodeVisuals) {
        if (nv.node.isJewelSocket) {
          drawRing(nv.node, nv.touchDistance);
        }
      }
    }
  };

  private touchOf(node: Node): number {
    if (node.isKeystone) {
      return 110;
    }
    if (node.isNotable || node.isJewelSocket) {
      return 70;
    }
    return 50;
  }

  destroy(): void {
    this.app?.destroy(true, { children: true, texture: false });
  }
}
