/**
 * Collapsible properties panel behavior.
 *
 * Handles panel collapse/expand with responsive behavior:
 * - Collapsed by default on viewport width < 768px
 * - Auto-expand when object selected
 * - Auto-collapse on deselect (optional)
 * - CSS transition animations
 */

// Breakpoint for mobile/touch layout
const MOBILE_BREAKPOINT = 768;

/**
 * Create panel state object.
 * @returns {object} Panel state
 */
export function createPanelState() {
  return {
    collapsed: false,
    autoCollapse: true,
    hasSelection: false
  };
}

/**
 * Create a collapsible properties panel controller.
 * @param {object} config - Configuration object
 * @param {HTMLElement} config.panel - Panel element
 * @param {HTMLElement} config.toggleButton - Toggle button element
 * @param {function} config.onToggle - Callback when panel toggled
 * @returns {object} Panel controller
 */
export function createPropertiesPanel(config) {
  const { panel, toggleButton, onToggle } = config;

  const state = createPanelState();

  // Check initial viewport width
  function checkViewportWidth() {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    if (isMobile && !state.hasSelection) {
      collapse(false);
    }
    return isMobile;
  }

  /**
   * Collapse the panel.
   * @param {boolean} animate - Whether to animate the transition
   */
  function collapse(animate = true) {
    if (state.collapsed) return;

    state.collapsed = true;
    panel.classList.add('collapsed');

    if (toggleButton) {
      toggleButton.classList.add('panel-collapsed');
      toggleButton.setAttribute('aria-expanded', 'false');
    }

    onToggle?.(false);
  }

  /**
   * Expand the panel.
   * @param {boolean} animate - Whether to animate the transition
   */
  function expand(animate = true) {
    if (!state.collapsed) return;

    state.collapsed = false;
    panel.classList.remove('collapsed');

    if (toggleButton) {
      toggleButton.classList.remove('panel-collapsed');
      toggleButton.setAttribute('aria-expanded', 'true');
    }

    onToggle?.(true);
  }

  /**
   * Toggle panel collapsed state.
   */
  function toggle() {
    if (state.collapsed) {
      expand();
    } else {
      collapse();
    }
  }

  /**
   * Update panel based on selection state.
   * @param {boolean} hasSelection - Whether something is selected
   */
  function updateSelection(hasSelection) {
    const hadSelection = state.hasSelection;
    state.hasSelection = hasSelection;

    // Auto-expand when selection made
    if (hasSelection && !hadSelection && state.collapsed) {
      expand();
    }

    // Auto-collapse when deselected (if autoCollapse enabled and on mobile)
    if (!hasSelection && hadSelection && state.autoCollapse) {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
      if (isMobile) {
        collapse();
      }
    }
  }

  /**
   * Set auto-collapse behavior.
   * @param {boolean} enabled - Whether to auto-collapse on deselect
   */
  function setAutoCollapse(enabled) {
    state.autoCollapse = enabled;
  }

  /**
   * Handle window resize.
   */
  function handleResize() {
    checkViewportWidth();
  }

  /**
   * Handle toggle button click.
   */
  function handleToggleClick(e) {
    e.preventDefault();
    toggle();
  }

  /**
   * Attach event listeners.
   */
  function attach() {
    window.addEventListener('resize', handleResize);

    if (toggleButton) {
      toggleButton.addEventListener('click', handleToggleClick);
    }

    // Initialize based on viewport
    checkViewportWidth();
  }

  /**
   * Detach event listeners.
   */
  function detach() {
    window.removeEventListener('resize', handleResize);

    if (toggleButton) {
      toggleButton.removeEventListener('click', handleToggleClick);
    }
  }

  /**
   * Check if panel is collapsed.
   */
  function isCollapsed() {
    return state.collapsed;
  }

  /**
   * Get panel state.
   */
  function getState() {
    return { ...state };
  }

  return {
    attach,
    detach,
    collapse,
    expand,
    toggle,
    isCollapsed,
    getState,
    updateSelection,
    setAutoCollapse
  };
}

/**
 * Create panel toggle button markup.
 * @returns {string} HTML string for toggle button
 */
export function createToggleButton() {
  return `
    <button id="panel-toggle" class="panel-toggle" aria-label="Toggle properties panel" aria-expanded="true">
      <svg class="chevron" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
      </svg>
    </button>
  `;
}

/**
 * Add panel header with toggle functionality.
 * @param {HTMLElement} panel - Panel element
 * @returns {HTMLElement} Toggle button element
 */
export function addPanelHeader(panel) {
  // Find or create header
  let header = panel.querySelector('.panel-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'panel-header';
    panel.insertBefore(header, panel.firstChild);
  }

  // Add toggle button
  header.insertAdjacentHTML('beforeend', createToggleButton());
  const toggleButton = header.querySelector('#panel-toggle');

  return toggleButton;
}
