/**
 * DOM utility functions
 */

/**
 * Returns element by id.
 * @param {string} id - Element id.
 * @returns {object} - DOM object associated with id.
 */
export function id(id) {
  return document.getElementById(id);
}

/**
 * Returns first element matching selector.
 * @param {string} selector - CSS query selector.
 * @returns {object} - DOM object associated selector.
 */
export function qs(selector) {
  return document.querySelector(selector);
}

/**
 * Returns an array of elements matching the given query.
 * @param {string} selector - CSS query selector.
 * @returns {array} - Array of DOM objects matching the given query.
 */
export function qsa(selector) {
  return document.querySelectorAll(selector);
}

/**
 * Caches frequently accessed DOM elements
 */
export function cacheElements() {
  return {
    divider: qs(".divider"),
    container: qs(".container"),
    menu: qs(".menu"),
    menuButtons: qsa(".menu-button"),
    content: qs(".content"),
    brainstormQAContainer: id('brainstormQAContainer'),
    intervieweeAvatar: id('intervieweeAvatar'),
    intervieweeIcon: id('intervieweeIcon'),
    intervieweeIconButton: id('intervieweeIconButton'),
    articleTextContainer: qs('.article-text-container .article-text'),
    playButton: id('playButton'),
    pauseReflectButton: id('pauseReflectButton'),
    micButton: id('micButton'),
    qaContainer: id('qaContainer'),
    interviewContent: id('interviewContent'),
    doneButton: id('doneButton'),
    brainstormTextarea: qs('.brainstorm-textarea'),
    brainstormSection: id('brainstormSection'),
    loadingIndicator: id('loadingIndicator')
  };
}

