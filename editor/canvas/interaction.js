/**
 * Gesture handling for touch and mouse interaction.
 *
 * Provides unified pointer event handling with support for:
 * - Single touch: tap (< 300ms, < 10px movement) or drag
 * - Two touches: pinch-zoom or two-finger pan
 * - Mouse: click, drag, wheel zoom
 */

import { screenToWorld, worldToScreen, pan, zoom, copyViewport } from './viewport.js';

// Touch radius for hit testing (24px for easier touch targets)
const TOUCH_RADIUS = 24;
const TAP_TIMEOUT = 300;
const TAP_THRESHOLD = 10;

// Drag state machine states
export const DragState = {
  IDLE: 'idle',
  DRAGGING: 'dragging',
  RESIZING: 'resizing',
  PANNING: 'panning',
  PINCHING: 'pinching'
};

/**
 * Create interaction state object.
 * @returns {object} Interaction state
 */
export function createInteractionState() {
  return {
    // Current drag state
    state: DragState.IDLE,

    // Touch tracking
    touches: new Map(),
    touchStartTime: 0,
    touchStartPos: null,

    // Gesture tracking
    initialPinchDistance: 0,
    initialPinchMidpoint: null,
    initialViewport: null,

    // Drag tracking
    dragTarget: null,
    dragType: null, // 'center' | 'radius'
    dragStartWorld: null,
    dragStartValue: null,

    // Outline overlay state (for outline-only drag feedback)
    outlineTarget: null,
    outlinePosition: null,
    outlineRadius: null,

    // Selection state (managed externally but tracked here)
    selectedBlob: null,
    hoveredBlob: null
  };
}

/**
 * Get position from a touch or mouse event.
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Touch|MouseEvent} event - Touch or mouse event
 * @returns {object} Position { x, y }
 */
export function getEventPosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

/**
 * Get all touch positions from a touch event.
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {TouchList} touches - Touch list from event
 * @returns {Array<object>} Array of { id, x, y }
 */
export function getTouchPositions(canvas, touches) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const positions = [];
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    positions.push({
      id: touch.identifier,
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY
    });
  }
  return positions;
}

/**
 * Calculate distance between two points.
 * @param {object} p1 - First point { x, y }
 * @param {object} p2 - Second point { x, y }
 * @returns {number} Distance
 */
export function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate midpoint between two points.
 * @param {object} p1 - First point { x, y }
 * @param {object} p2 - Second point { x, y }
 * @returns {object} Midpoint { x, y }
 */
export function midpoint(p1, p2) {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2
  };
}

/**
 * Hit test for blob center with touch-friendly radius.
 * @param {Array} blobs - Array of blob objects
 * @param {object} viewport - Viewport state
 * @param {number} screenX - Screen X position
 * @param {number} screenY - Screen Y position
 * @param {number} threshold - Hit test threshold in pixels
 * @returns {object|null} Hit blob or null
 */
export function hitTestBlobCenter(blobs, viewport, screenX, screenY, threshold = TOUCH_RADIUS) {
  for (const blob of blobs) {
    const screenPos = worldToScreen(viewport, blob.x, blob.z);
    const dist = distance({ x: screenX, y: screenY }, screenPos);
    if (dist < threshold) {
      return blob;
    }
  }
  return null;
}

/**
 * Hit test for blob radius edge.
 * @param {Array} blobs - Array of blob objects
 * @param {object} viewport - Viewport state
 * @param {number} screenX - Screen X position
 * @param {number} screenY - Screen Y position
 * @param {number} threshold - Hit test threshold in pixels
 * @returns {object|null} Hit blob or null
 */
export function hitTestBlobRadius(blobs, viewport, screenX, screenY, threshold = TOUCH_RADIUS) {
  for (const blob of blobs) {
    const screenPos = worldToScreen(viewport, blob.x, blob.z);
    const radiusPixels = blob.radius * viewport.scale;
    const dist = distance({ x: screenX, y: screenY }, screenPos);
    // Check if near the radius circle edge
    if (Math.abs(dist - radiusPixels) < threshold) {
      return blob;
    }
  }
  return null;
}

/**
 * Hit test for Voronoi cell edges.
 * @param {Map} cells - Map of blobId -> polygon vertices
 * @param {object} viewport - Viewport state
 * @param {number} screenX - Screen X position
 * @param {number} screenY - Screen Y position
 * @param {number} threshold - Hit test threshold in pixels
 * @returns {string|null} Hit cell blobId or null
 */
export function hitTestCellEdge(cells, viewport, screenX, screenY, threshold = TOUCH_RADIUS) {
  for (const [blobId, polygon] of cells) {
    if (!polygon || polygon.length < 3) continue;

    for (let i = 0; i < polygon.length; i++) {
      const p1 = worldToScreen(viewport, polygon[i].x, polygon[i].z);
      const p2 = worldToScreen(viewport, polygon[(i + 1) % polygon.length].x, polygon[(i + 1) % polygon.length].z);

      const dist = pointToLineDistance({ x: screenX, y: screenY }, p1, p2);
      if (dist < threshold) {
        return blobId;
      }
    }
  }
  return null;
}

/**
 * Calculate distance from point to line segment.
 * @param {object} p - Point { x, y }
 * @param {object} a - Line start { x, y }
 * @param {object} b - Line end { x, y }
 * @returns {number} Distance
 */
function pointToLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return distance(p, a);
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy
  };

  return distance(p, closest);
}

/**
 * Create a touch interaction handler.
 * @param {object} config - Configuration object
 * @param {HTMLCanvasElement} config.canvas - Main canvas element
 * @param {HTMLCanvasElement} config.overlayCanvas - Overlay canvas for drag feedback
 * @param {function} config.getViewport - Function to get current viewport
 * @param {function} config.setViewport - Function to set viewport
 * @param {function} config.getBlobs - Function to get blob array
 * @param {function} config.onTap - Callback for tap { x, y, worldX, worldZ }
 * @param {function} config.onDragStart - Callback when drag starts { target, type }
 * @param {function} config.onDragMove - Callback during drag { target, worldX, worldZ, radius }
 * @param {function} config.onDragEnd - Callback when drag ends { target, committed }
 * @param {function} config.onViewportChange - Callback when viewport changes
 * @param {function} config.render - Function to trigger re-render
 * @returns {object} Handler object with attach/detach methods
 */
export function createInteractionHandler(config) {
  const {
    canvas,
    overlayCanvas,
    getViewport,
    setViewport,
    getBlobs,
    onTap,
    onDragStart,
    onDragMove,
    onDragEnd,
    onViewportChange,
    render
  } = config;

  const state = createInteractionState();

  // Overlay context for outline rendering
  const overlayCtx = overlayCanvas?.getContext('2d');

  /**
   * Clear the overlay canvas.
   */
  function clearOverlay() {
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  }

  /**
   * Draw outline on overlay during drag.
   */
  function drawOutline() {
    if (!overlayCtx || !state.outlineTarget) return;

    clearOverlay();

    const viewport = getViewport();
    const pos = state.outlinePosition || { x: state.outlineTarget.x, z: state.outlineTarget.z };
    const radius = state.outlineRadius ?? state.outlineTarget.radius;
    const screenPos = worldToScreen(viewport, pos.x, pos.z);
    const screenRadius = radius * viewport.scale;

    overlayCtx.strokeStyle = '#e94560';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);

    // Draw radius circle
    overlayCtx.beginPath();
    overlayCtx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    overlayCtx.stroke();

    // Draw center point
    overlayCtx.setLineDash([]);
    overlayCtx.beginPath();
    overlayCtx.arc(screenPos.x, screenPos.y, 6, 0, Math.PI * 2);
    overlayCtx.fillStyle = '#e94560';
    overlayCtx.fill();
  }

  /**
   * Handle pointer/touch start.
   */
  function handlePointerDown(e) {
    e.preventDefault();

    const touches = e.touches ? getTouchPositions(canvas, e.touches) : null;
    const pos = getEventPosition(canvas, e.touches ? e.touches[0] : e);

    if (touches && touches.length === 2) {
      // Two-finger gesture starting
      state.state = DragState.PINCHING;
      state.initialPinchDistance = distance(touches[0], touches[1]);
      state.initialPinchMidpoint = midpoint(touches[0], touches[1]);
      state.initialViewport = copyViewport(getViewport());
      return;
    }

    // Single touch/click
    state.touchStartTime = Date.now();
    state.touchStartPos = pos;

    // Hit test with touch-friendly radius
    const viewport = getViewport();
    const blobs = getBlobs();

    // Test vertices first (centers), then edges (radius)
    let hitCenter = hitTestBlobCenter(blobs, viewport, pos.x, pos.y);
    let hitRadius = !hitCenter ? hitTestBlobRadius(blobs, viewport, pos.x, pos.y) : null;

    if (hitCenter) {
      // Start dragging center
      state.state = DragState.DRAGGING;
      state.dragTarget = hitCenter;
      state.dragType = 'center';
      state.dragStartWorld = screenToWorld(viewport, pos.x, pos.y);
      state.dragStartValue = { x: hitCenter.x, z: hitCenter.z };

      // Set up outline
      state.outlineTarget = hitCenter;
      state.outlinePosition = { x: hitCenter.x, z: hitCenter.z };
      state.outlineRadius = hitCenter.radius;

      onDragStart?.({ target: hitCenter, type: 'center' });
      drawOutline();
    } else if (hitRadius) {
      // Start resizing (dragging radius)
      state.state = DragState.RESIZING;
      state.dragTarget = hitRadius;
      state.dragType = 'radius';
      state.dragStartWorld = screenToWorld(viewport, pos.x, pos.y);
      state.dragStartValue = hitRadius.radius;

      // Set up outline
      state.outlineTarget = hitRadius;
      state.outlinePosition = { x: hitRadius.x, z: hitRadius.z };
      state.outlineRadius = hitRadius.radius;

      onDragStart?.({ target: hitRadius, type: 'radius' });
      drawOutline();
    } else {
      // No hit - could be tap or pan start
      // We'll decide on pointer up/move
    }
  }

  /**
   * Handle pointer/touch move.
   */
  function handlePointerMove(e) {
    e.preventDefault();

    const touches = e.touches ? getTouchPositions(canvas, e.touches) : null;
    const pos = getEventPosition(canvas, e.touches ? e.touches[0] : e);
    const viewport = getViewport();

    if (state.state === DragState.PINCHING && touches && touches.length === 2) {
      // Two-finger pinch/pan
      const currentDistance = distance(touches[0], touches[1]);
      const currentMidpoint = midpoint(touches[0], touches[1]);

      // Calculate scale change
      const scaleFactor = currentDistance / state.initialPinchDistance;

      // Calculate pan delta
      const panDx = currentMidpoint.x - state.initialPinchMidpoint.x;
      const panDy = currentMidpoint.y - state.initialPinchMidpoint.y;

      // Apply to viewport
      const newViewport = copyViewport(state.initialViewport);

      // First pan
      pan(newViewport, panDx, panDy);

      // Then zoom around the midpoint
      zoom(newViewport, scaleFactor, currentMidpoint.x, currentMidpoint.y);

      setViewport(newViewport);
      onViewportChange?.(newViewport);
      render();
      return;
    }

    if (state.state === DragState.DRAGGING && state.dragTarget) {
      // Update outline position
      const worldPos = screenToWorld(viewport, pos.x, pos.y);
      state.outlinePosition = { x: worldPos.x, z: worldPos.z };

      onDragMove?.({
        target: state.dragTarget,
        worldX: worldPos.x,
        worldZ: worldPos.z
      });

      drawOutline();
      return;
    }

    if (state.state === DragState.RESIZING && state.dragTarget) {
      // Update outline radius
      const worldPos = screenToWorld(viewport, pos.x, pos.y);
      const dx = worldPos.x - state.dragTarget.x;
      const dz = worldPos.z - state.dragTarget.z;
      const newRadius = Math.max(0.05, Math.sqrt(dx * dx + dz * dz));
      state.outlineRadius = newRadius;

      onDragMove?.({
        target: state.dragTarget,
        radius: newRadius
      });

      drawOutline();
      return;
    }

    if (state.state === DragState.PANNING) {
      // Pan viewport
      if (state.touchStartPos) {
        const dx = pos.x - state.touchStartPos.x;
        const dy = pos.y - state.touchStartPos.y;
        pan(viewport, dx, dy);
        state.touchStartPos = pos;
        setViewport(viewport);
        onViewportChange?.(viewport);
        render();
      }
      return;
    }

    // Check if we should start panning (moved beyond tap threshold)
    if (state.state === DragState.IDLE && state.touchStartPos) {
      const moved = distance(pos, state.touchStartPos);
      if (moved > TAP_THRESHOLD) {
        // Start panning
        state.state = DragState.PANNING;
      }
    }
  }

  /**
   * Handle pointer/touch end.
   */
  function handlePointerUp(e) {
    e.preventDefault();

    const pos = state.touchStartPos || { x: 0, y: 0 };
    const viewport = getViewport();

    if (state.state === DragState.PINCHING) {
      // End pinch gesture
      state.state = DragState.IDLE;
      state.initialPinchDistance = 0;
      state.initialPinchMidpoint = null;
      state.initialViewport = null;
      return;
    }

    if (state.state === DragState.DRAGGING && state.dragTarget && state.outlinePosition) {
      // Commit drag
      state.dragTarget.x = state.outlinePosition.x;
      state.dragTarget.z = state.outlinePosition.z;

      onDragEnd?.({ target: state.dragTarget, committed: true });
      clearOverlay();

      state.state = DragState.IDLE;
      state.dragTarget = null;
      state.outlineTarget = null;
      state.outlinePosition = null;
      render();
      return;
    }

    if (state.state === DragState.RESIZING && state.dragTarget && state.outlineRadius != null) {
      // Commit resize
      state.dragTarget.radius = state.outlineRadius;

      onDragEnd?.({ target: state.dragTarget, committed: true });
      clearOverlay();

      state.state = DragState.IDLE;
      state.dragTarget = null;
      state.outlineTarget = null;
      state.outlineRadius = null;
      render();
      return;
    }

    if (state.state === DragState.PANNING) {
      // End pan
      state.state = DragState.IDLE;
      state.touchStartPos = null;
      return;
    }

    // Check for tap
    if (state.state === DragState.IDLE && state.touchStartPos) {
      const elapsed = Date.now() - state.touchStartTime;
      const finalPos = getEventPosition(canvas, e.changedTouches ? e.changedTouches[0] : e);
      const moved = distance(finalPos, state.touchStartPos);

      if (elapsed < TAP_TIMEOUT && moved < TAP_THRESHOLD) {
        // It's a tap
        const worldPos = screenToWorld(viewport, state.touchStartPos.x, state.touchStartPos.y);
        onTap?.({
          x: state.touchStartPos.x,
          y: state.touchStartPos.y,
          worldX: worldPos.x,
          worldZ: worldPos.z
        });
      }
    }

    // Reset state
    state.state = DragState.IDLE;
    state.touchStartPos = null;
    state.dragTarget = null;
  }

  /**
   * Handle touch cancel.
   */
  function handleTouchCancel(e) {
    // Cancel any ongoing gesture
    clearOverlay();
    state.state = DragState.IDLE;
    state.dragTarget = null;
    state.outlineTarget = null;
    state.touchStartPos = null;
  }

  /**
   * Handle mouse wheel for zoom.
   */
  function handleWheel(e) {
    e.preventDefault();

    const pos = getEventPosition(canvas, e);
    const viewport = getViewport();

    // Zoom factor based on wheel delta
    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    zoom(viewport, factor, pos.x, pos.y);
    setViewport(viewport);
    onViewportChange?.(viewport);
    render();
  }

  /**
   * Handle context menu (prevent default).
   */
  function handleContextMenu(e) {
    e.preventDefault();
  }

  /**
   * Attach event listeners.
   */
  function attach() {
    // Use pointer events for unified handling
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handleTouchCancel);

    // Also handle touch events directly for multi-touch
    canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
    canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
    canvas.addEventListener('touchend', handlePointerUp, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchCancel);

    // Mouse wheel for zoom
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Context menu
    canvas.addEventListener('contextmenu', handleContextMenu);
  }

  /**
   * Detach event listeners.
   */
  function detach() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handleTouchCancel);

    canvas.removeEventListener('touchstart', handlePointerDown);
    canvas.removeEventListener('touchmove', handlePointerMove);
    canvas.removeEventListener('touchend', handlePointerUp);
    canvas.removeEventListener('touchcancel', handleTouchCancel);

    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('contextmenu', handleContextMenu);
  }

  /**
   * Get current interaction state.
   */
  function getState() {
    return state;
  }

  /**
   * Check if currently dragging.
   */
  function isDragging() {
    return state.state === DragState.DRAGGING || state.state === DragState.RESIZING;
  }

  /**
   * Check if currently in a gesture.
   */
  function isGesturing() {
    return state.state !== DragState.IDLE;
  }

  return {
    attach,
    detach,
    getState,
    isDragging,
    isGesturing,
    clearOverlay
  };
}

/**
 * Resize overlay canvas to match main canvas.
 * @param {HTMLCanvasElement} overlay - Overlay canvas
 * @param {HTMLCanvasElement} main - Main canvas
 */
export function resizeOverlay(overlay, main) {
  overlay.width = main.width;
  overlay.height = main.height;
}
