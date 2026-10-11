/* Shared measuring instruments for the browser tests and the screenshot script.
 *
 * `paintCssBackground` and the WCAG maths live in the core (`src/core/utils.js`) — the theme
 * uses them to pick the ink that reads on a wallpaper, and the tests use them to measure
 * contrast against real pixels. They are re-exported here so the browser suite has one place to
 * import the tools it shares with the app, and so "one contrast formula" is a fact about the
 * imports rather than a hope.
 */
export {
  paintCssBackground, contrastRatio, relLuminance, hexToRgb, rgbOf, rgbaOf, mixOver,
} from '../../src/core/utils.js';
