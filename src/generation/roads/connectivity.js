/**
 * Road connectivity graph
 *
 * Builds a minimum spanning tree over settlements, then optionally adds
 * shortcut edges for more interesting road topology.
 */

import { distance } from '../../core/math.js';

// ---------------------------------------------------------------------------
// Union-Find for Kruskal's MST
// ---------------------------------------------------------------------------

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Uint8Array(n);
  }

  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Road type classification
// ---------------------------------------------------------------------------

/**
 * Determine road type from endpoint settlement types.
 *
 * - Highway: either endpoint is a city
 * - Road: both endpoints are villages
 * - Path: at least one endpoint is a hamlet
 */
function classifyRoadType(typeA, typeB) {
  if (typeA === 'city' || typeB === 'city') return 'highway';
  if (typeA === 'village' && typeB === 'village') return 'road';
  return 'path';
}

// ---------------------------------------------------------------------------
// MST path distance (BFS on adjacency list)
// ---------------------------------------------------------------------------

/**
 * Compute shortest path distance between two nodes in the MST using BFS
 * weighted by Euclidean edge lengths.
 */
function mstPathDistance(adj, settlements, fromIdx, toIdx) {
  const n = settlements.length;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  dist[fromIdx] = 0;
  const visited = new Uint8Array(n);
  const queue = [fromIdx];

  while (queue.length > 0) {
    // Simple Dijkstra with array scan (n is tiny, <20 settlements)
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < queue.length; i++) {
      if (dist[queue[i]] < bestDist) {
        bestDist = dist[queue[i]];
        bestIdx = i;
      }
    }

    const u = queue[bestIdx];
    queue.splice(bestIdx, 1);

    if (visited[u]) continue;
    visited[u] = 1;

    if (u === toIdx) return dist[u];

    for (const v of adj[u]) {
      const d = dist[u] + distance(
        settlements[u].position[0], settlements[u].position[1],
        settlements[v].position[0], settlements[v].position[1],
      );
      if (d < dist[v]) {
        dist[v] = d;
        if (!visited[v]) queue.push(v);
      }
    }
  }

  return Infinity;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a road connectivity graph from settlements.
 *
 * 1. Compute all pairwise Euclidean distances
 * 2. Build MST using Kruskal's algorithm
 * 3. Add shortcut edges where MST path >> Euclidean distance
 * 4. Assign road types based on settlement endpoint types
 *
 * @param {Array} settlements - Settlement objects with .position [x,z], .type, .id
 * @param {Function} rng - Seeded random function () => [0,1)
 * @returns {Array<{ from: string, to: string, fromIdx: number, toIdx: number, euclideanDist: number, type: string }>}
 */
export function buildConnectivityGraph(settlements, rng) {
  const n = settlements.length;
  if (n <= 1) return [];

  // Build all pairwise edges
  const allEdges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(
        settlements[i].position[0], settlements[i].position[1],
        settlements[j].position[0], settlements[j].position[1],
      );
      allEdges.push({ i, j, dist: d });
    }
  }

  // Sort by distance for Kruskal's
  allEdges.sort((a, b) => a.dist - b.dist);

  // Build MST
  const uf = new UnionFind(n);
  const mstEdges = [];
  const mstSet = new Set();

  for (const edge of allEdges) {
    if (uf.union(edge.i, edge.j)) {
      mstEdges.push(edge);
      mstSet.add(`${edge.i}-${edge.j}`);
      if (mstEdges.length === n - 1) break;
    }
  }

  // Build adjacency list for MST path queries
  const adj = Array.from({ length: n }, () => []);
  for (const e of mstEdges) {
    adj[e.i].push(e.j);
    adj[e.j].push(e.i);
  }

  // Look for shortcut edges
  const shortcuts = [];
  for (const edge of allEdges) {
    if (mstSet.has(`${edge.i}-${edge.j}`)) continue;

    const mstDist = mstPathDistance(adj, settlements, edge.i, edge.j);
    if (mstDist === Infinity) continue;

    // Add shortcut if MST path is significantly longer than direct
    if (edge.dist < mstDist * 0.6) {
      shortcuts.push(edge);
    }
  }

  // Sort shortcuts by how much they save, take at most 2
  shortcuts.sort((a, b) => {
    const savA = mstPathDistance(adj, settlements, a.i, a.j) - a.dist;
    const savB = mstPathDistance(adj, settlements, b.i, b.j) - b.dist;
    return savB - savA;
  });

  const selectedShortcuts = shortcuts.slice(0, 2);

  // Combine MST + shortcuts and classify road types
  const result = [];
  for (const edge of [...mstEdges, ...selectedShortcuts]) {
    const sA = settlements[edge.i];
    const sB = settlements[edge.j];
    result.push({
      from: sA.id,
      to: sB.id,
      fromIdx: edge.i,
      toIdx: edge.j,
      euclideanDist: edge.dist,
      type: classifyRoadType(sA.type, sB.type),
    });
  }

  return result;
}
