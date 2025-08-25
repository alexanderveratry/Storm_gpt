# Assets Directory

This directory contains static assets for the Conversational Tree application.

## Logo
- Place your logo file here (e.g., `logo.png`, `logo.svg`)
- Update the HTML in `index.html` to reference your logo:
  ```html
  <img src="assets/logo.png" alt="Conversational Tree Logo" class="logo-image">
  ```

## Animation Files
- For Lottie animations: Place `.json` files here
- For video animations: Place `.mp4`, `.webm` files here
- For CSS animations: Additional styles can be added to `style.css`

## Supported Formats
- **Images**: PNG, JPG, SVG, WebP
- **Animations**: Lottie JSON, CSS animations, video files
- **Fonts**: TTF, WOFF, WOFF2 (if needed)

## Current Setup
The splash screen currently uses a CSS-generated SVG logo with animations. You can replace this with your actual logo by:

1. Adding your logo file to this directory
2. Updating the HTML in the `.logo-container` section
3. Adjusting CSS animations if needed

## Animation Customization
You can customize the splash screen animations by modifying the CSS variables and keyframes in `style.css`:

- `SPLASH_DURATION` in `app.js` - Controls how long the splash is shown
- Animation timing and effects in the CSS keyframes
- Colors and styling using CSS custom properties
