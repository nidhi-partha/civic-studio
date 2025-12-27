/**
 * UI utility functions
 */

import { id } from './reading-page-dom-utils.js';
import { IMAGES } from './reading-page-constants.js';

/**
 * Shows loading overlay with optional message
 */
export function showLoadingOverlay(message = 'Loading...') {
  const overlay = id('loading-overlay');
  const textElement = overlay?.querySelector('.loading-text');
  if (overlay) {
    if (textElement) textElement.textContent = message;
    overlay.style.display = 'flex';
  }
}

/**
 * Updates loading overlay message
 */
export function updateLoadingText(message) {
  const overlay = id('loading-overlay');
  const textElement = overlay?.querySelector('.loading-text');
  if (textElement) {
    textElement.textContent = message;
  }
}

/**
 * Hides loading overlay
 */
export function hideLoadingOverlay() {
  const overlay = id('loading-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * Creates a button element
 */
export function createButton(text, className, title) {
  const button = document.createElement('button');
  button.innerText = text;
  button.classList.add('control-button', 'control-button-with-margin', className);
  button.title = title;
  return button;
}

/**
 * Creates an icon element
 */
export function createIcon(src, alt, title) {
  const icon = document.createElement('img');
  icon.src = src;
  icon.alt = alt;
  icon.classList.add('icon-cursor');
  icon.title = title;
  return icon;
}

