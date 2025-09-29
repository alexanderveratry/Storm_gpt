/*
 * treeRenderer.js — D3.js Tree Visualization
 * Renderizado del árbol conversacional usando D3.js
 */

import { LAYOUT, ZOOM_EXTENT, SELECTORS } from './constants.js';
import { escapeHTML, truncate } from './utils.js';

export class TreeRenderer {
  constructor(svgSel) {
    this.svg = d3.select(svgSel);
    this.g = this.svg.append('g');

    const zoom = d3.zoom().scaleExtent(ZOOM_EXTENT).on('zoom', (ev) => {
      this.g.attr('transform', ev.transform);
    });
    this.svg.call(zoom);
  }

  update(tree, updateAll, updateVisualization, updateSidebar, showNodeInfo) {
    if (!tree) return;
    const data = tree.getTreeData();
    this.g.selectAll('*').remove();
    if (!data.nodes.length) return;

    // adjacency
    const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
    const childrenById = new Map();
    data.nodes.forEach((n) => childrenById.set(n.id, []));
    data.links.forEach((l) => {
      if (childrenById.has(l.source)) childrenById.get(l.source).push(l.target);
    });

    // compute hierarchical positions
    this._layoutHierarchy(data, nodesById, childrenById, tree);

    // layers
    const linkLayer = this.g.append('g').attr('class', 'link-layer');
    const wrapperLayer = this.g.append('g').attr('class', 'wrapper-layer');

    // links
    const linksData = data.links.map((l) => ({ source: nodesById.get(l.source), target: nodesById.get(l.target) }));
    const link = linkLayer
      .selectAll('line')
      .data(linksData)
      .join('line')
      .attr('class', (d) => {
        const path = tree.getPathToNode(tree.currentNodeId);
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return `link ${inPath ? 'active-path' : ''}`;
      })
      .attr('x1', (d) => this._posX(d.source))
      .attr('y1', (d) => this._posY(d.source))
      .attr('x2', (d) => this._posX(d.target))
      .attr('y2', (d) => this._posY(d.target));

    // nodes
    const nodeG = this.g
      .append('g')
      .selectAll('g.node-wrap')
      .data(data.nodes)
      .join('g')
      .attr('class', 'node-wrap')
      .attr('data-node-id', (d) => d.id)
      .attr('tabindex', 0)
      .call(
        d3
          .drag()
          .on('start', (_, d) => {
            d.fx = this._posX(d);
            d.fy = this._posY(d);
          })
          .on('drag', (ev, d) => {
            d.fx = ev.x;
            d.fy = ev.y;
            updatePositions();
          })
          .on('end', (ev, d) => {
            d.fx = ev.x;
            d.fy = ev.y;
            updatePositions();
          }),
      )
      .on('click', (_, d) => {
        tree.currentNodeId = d.id;
        updateAll(); // no view reset/recenter
        showNodeInfo(d);
      })
      .on('keydown', (ev, d) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          tree.currentNodeId = d.id;
          updateAll();
          showNodeInfo(d);
        }
      })
      // accessibility and tooltip using native title attribute
      .attr('aria-label', (d) => {
        const content = d.content || '';
        const truncated = content.length > 100 ? content.substring(0, 100) + '...' : content;
        return `Node: ${truncated}`;
      })
      .attr('title', (d) => d.content || '')
      .attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);

    nodeG
      .filter((d) => d.role === 'assistant')
      .append('circle')
      .attr('class', (d) => `node ${d.id === tree.currentNodeId ? 'active' : ''}`)
      .attr('r', (d) => 8 + (d.importance ?? 0) * 4);

    nodeG
      .filter((d) => d.role !== 'assistant')
      .append('rect')
      .attr('class', (d) => `node user ${d.id === tree.currentNodeId ? 'active' : ''}`)
      .attr('width', (d) => 16 + (d.importance ?? 0) * 8)
      .attr('height', (d) => 16 + (d.importance ?? 0) * 8)
      .attr('x', (d) => -(8 + (d.importance ?? 0) * 4))
      .attr('y', (d) => -(8 + (d.importance ?? 0) * 4))
      .attr('transform', 'rotate(45)');

    // labels
    const labels = this.g
      .append('g')
      .selectAll('foreignObject')
      .data(data.nodes)
      .join('foreignObject')
      .attr('class', 'node-label')
      .attr('width', LAYOUT.label.w)
      .attr('height', LAYOUT.label.h)
      .style('cursor', 'pointer') // Indicar que es clickeable
      .on('click', (ev, d) => {
        // Aplicar el mismo comportamiento de enfoque que el chat
        ev.stopPropagation(); // Evitar que se propague al nodo padre
        tree.currentNodeId = d.id;
        updateAll();
        console.log(`🏷️ Label clicked: Focus changed to node ${d.id}`);
      })
      .html((d) => {
        const full = tree.nodes.get(d.id);
        const viewState = tree.getEffectiveViewState(d.id);
        
        // Modo stickers: mostrar imagen si existe
        if (viewState === 'stickers') {
          if (full?.image) {
            return `<div xmlns="http://www.w3.org/1999/xhtml" class="label-box sticker-mode">
                      <div class="sticker-container">
                        <img src="${full.image}" alt="Sticker" class="node-sticker-img" />
                        <div class="sticker-caption">${escapeHTML(truncate(full.content, 50))}</div>
                      </div>
                    </div>`;
          } else {
            return `<div xmlns="http://www.w3.org/1999/xhtml" class="label-box sticker-mode no-sticker">
                      <div class="no-sticker-placeholder">
                        <div class="no-sticker-icon">🎨</div>
                        <div class="no-sticker-text">Sin sticker</div>
                        <div class="sticker-caption">${escapeHTML(truncate(full.content, 50))}</div>
                      </div>
                    </div>`;
          }
        }
        
        // Modos normales (summary/content)
        let displayText;
        if (viewState === true) {
          // Show full content
          displayText = full?.content ?? '';
        } else {
          // Show summary
          let summary = full?.summary;
          if (!summary) summary = full?.summaryGenerating ? '…' : truncate(full?.content ?? '', 160);
          displayText = summary;
        }
        
        return `<div xmlns="http://www.w3.org/1999/xhtml" class="label-box">
                  <div class="content-display">${escapeHTML(truncate(displayText, viewState === true ? 400 : 200))}</div>
                </div>`;
      });

    const shapeBBox = (n) => {
      if (n.role === 'assistant') {
        const r = 8 + (n.importance ?? 0) * 4;
        return { left: this._posX(n) - r, right: this._posX(n) + r, top: this._posY(n) - r, bottom: this._posY(n) + r };
      } else {
        const size = 16 + (n.importance ?? 0) * 8;
        const dist = size / Math.SQRT2;
        return {
          left: this._posX(n) - dist,
          right: this._posX(n) + dist,
          top: this._posY(n) - dist,
          bottom: this._posY(n) + dist,
        };
      }
    };

    const labelRects = () => {
      const rects = [];
      labels.each((d) => {
        rects.push({
          d,
          x: this._posX(d) - LAYOUT.label.w / 2,
          y: this._posY(d) + LAYOUT.label.offset,
          w: LAYOUT.label.w,
          h: LAYOUT.label.h,
        });
      });
      return rects;
    };

    const unionWrapperFrom = (d, rLabel) => {
      const s = shapeBBox(d);
      const m = LAYOUT.wrapperMargin;
      const left = Math.min(s.left, rLabel.x) - m;
      const right = Math.max(s.right, rLabel.x + rLabel.w) + m;
      const top = Math.min(s.top, rLabel.y) - m;
      const bottom = Math.max(s.bottom, rLabel.y + rLabel.h) + m;
      return { node: d, left, top, right, bottom, get w() { return this.right - this.left; }, get h() { return this.bottom - this.top; } };
    };

    const drawWrappersFrom = (wrappers) => {
      wrapperLayer
        .selectAll('rect')
        .data(wrappers, (w) => w.node.id)
        .join('rect')
        .attr('class', (w) => `node-wrapper-box ${w.node.id === tree.currentNodeId ? 'active' : ''}`)
        .attr('x', (w) => w.left)
        .attr('y', (w) => w.top)
        .attr('width', (w) => w.w)
        .attr('height', (w) => w.h)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('pointer-events', 'none');
    };

    const updatePositions = () => {
      link
        .attr('x1', (d) => this._posX(d.source))
        .attr('y1', (d) => this._posY(d.source))
        .attr('x2', (d) => this._posX(d.target))
        .attr('y2', (d) => this._posY(d.target));
      nodeG.attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);
      labels.attr('x', (d) => this._posX(d) - LAYOUT.label.w / 2).attr('y', (d) => this._posY(d) + LAYOUT.label.offset);

      // wrappers
      let lrs = labelRects();
      const byId = new Map(lrs.map((r) => [r.d.id, r]));
      let wrappers = data.nodes.map((n) => unionWrapperFrom(n, byId.get(n.id)));
      drawWrappersFrom(wrappers);

      // repulsion of wrappers (global, prevents overlap)
      const ensureAnchors = () => {
        data.nodes.forEach((n) => {
          if (n.fx == null) n.fx = this._posX(n);
          if (n.fy == null) n.fy = this._posY(n);
        });
      };

      const resolveWrapperOverlaps = () => {
        let movedAny = false;
        for (let it = 0; it < LAYOUT.repelIterations; it++) {
          let moved = false;

          lrs = labelRects();
          const map2 = new Map(lrs.map((r) => [r.d.id, r]));
          wrappers = data.nodes.map((n) => unionWrapperFrom(n, map2.get(n.id)));

          for (let i = 0; i < wrappers.length; i++) {
            for (let j = i + 1; j < wrappers.length; j++) {
              const a = wrappers[i];
              const b = wrappers[j];

              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

              if (overlapX > 0 && overlapY > 0) {
                const needX = overlapX + LAYOUT.wrapperGap;
                const needY = overlapY + LAYOUT.wrapperGap;

                if (needX < needY) {
                  const push = needX / 2;
                  const aCenter = (a.left + a.right) / 2;
                  const bCenter = (b.left + b.right) / 2;
                  const dir = aCenter <= bCenter ? -1 : 1;
                  a.node.fx += dir * push;
                  b.node.fx -= dir * push;
                } else {
                  const push = needY / 2;
                  const aCenter = (a.top + a.bottom) / 2;
                  const bCenter = (b.top + b.bottom) / 2;
                  const dir = aCenter <= bCenter ? -1 : 1;
                  a.node.fy += dir * push;
                  b.node.fy -= dir * push;
                }
                moved = true;
              }
            }
          }

          if (moved) {
            movedAny = true;
            link
              .attr('x1', (d) => this._posX(d.source))
              .attr('y1', (d) => this._posY(d.source))
              .attr('x2', (d) => this._posX(d.target))
              .attr('y2', (d) => this._posY(d.target));
            nodeG.attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);
            labels.attr('x', (d) => this._posX(d) - LAYOUT.label.w / 2).attr('y', (d) => this._posY(d) + LAYOUT.label.offset);
          } else break;
        }
        return movedAny;
      };

      ensureAnchors();
      const moved = resolveWrapperOverlaps();

      if (moved) {
        lrs = labelRects();
        const map3 = new Map(lrs.map((r) => [r.d.id, r]));
        wrappers = data.nodes.map((n) => unionWrapperFrom(n, map3.get(n.id)));
      }
      drawWrappersFrom(wrappers);
    };

    updatePositions();
  }

  /* ----- Hierarchical layout helpers ----- */

  _posX(n) { return n.fx ?? n.layoutX ?? 0; }
  _posY(n) { return n.fy ?? n.layoutY ?? 0; }

  _svgSize() {
    const node = this.svg.node();
    const bb = node.getBoundingClientRect();
    return { w: bb.width || 800, h: bb.height || 600 };
  }

  /**
   * Place roots at center, and for each parent, place children to the right (same X),
   * and pack siblings vertically around parent's Y with minimal gap (no overlap),
   * later refined by wrapper repulsion.
   */
  _layoutHierarchy(data, nodesById, childrenById, tree) {
    // clear previous layout unless fixed
    data.nodes.forEach((n) => {
      if (n.fx == null) n.layoutX = undefined;
      if (n.fy == null) n.layoutY = undefined;
    });

    const { w, h } = this._svgSize();
    const centerX = w / 2;
    const centerY = h / 2;

    // prefer the tree.rootId as the main root
    const roots = data.nodes.filter((n) => !n.parentId);
    if (roots.length === 0) return;

    // place the first root at center; remaining roots stacked vertically
    const rootMain = nodesById.get(tree.rootId) || roots[0];
    const extraRoots = roots.filter((r) => r.id !== rootMain.id);

    this._ensurePlaced(rootMain, centerX, centerY);
    const rootGap = Math.max(LAYOUT.siblingGapMin, LAYOUT.label.h + 2 * LAYOUT.wrapperMargin);
    extraRoots.forEach((r, i) => {
      this._ensurePlaced(r, centerX, centerY + (i + 1) * rootGap);
    });

    // BFS from all roots
    const queue = [rootMain, ...extraRoots];
    const seen = new Set(queue.map((n) => n.id));

    while (queue.length) {
      const parent = queue.shift();
      const kidsIds = childrenById.get(parent.id) || [];
      const kids = kidsIds.map((id) => nodesById.get(id)).filter(Boolean);
      if (!kids.length) continue;

      // Parent anchor
      const px = this._posX(parent);
      const py = this._posY(parent);

      // children x aligned on a straight line to the right of parent
      const cx = px + LAYOUT.levelDX;

      // minimal vertical gap = label height + margin, but allow tighter if shapes are small
      const minGap = Math.max(LAYOUT.siblingGapMin, LAYOUT.label.h + 2 * LAYOUT.wrapperMargin);

      // center siblings around parent y
      const yStart = py - ((kids.length - 1) * minGap) / 2;

      kids.forEach((child, i) => {
        if (child.fx == null && child.fy == null) {
          this._ensurePlaced(child, cx, yStart + i * minGap);
        }
        if (!seen.has(child.id)) {
          seen.add(child.id);
          queue.push(child);
        }
      });
    }
  }

  _ensurePlaced(n, x, y) {
    if (n.fx == null && n.layoutX == null) n.layoutX = x;
    if (n.fy == null && n.layoutY == null) n.layoutY = y;
  }

}
