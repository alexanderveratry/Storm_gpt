/*
 * splashScreen.js — Splash Screen Management
 * Manejo de la pantalla de splash al inicio de la aplicación.
 */

import { SPLASH_DURATION } from './constants.js';

// Check if this is a fresh app launch (not a navigation)
export function isFreshAppLaunch() {
  // Check if we've shown the splash screen in this session
  const hasShownSplash = sessionStorage.getItem('splashShown');
  console.log('🔍 Checking if fresh app launch. hasShownSplash:', hasShownSplash);
  const isFresh = !hasShownSplash;
  console.log('🔍 isFreshAppLaunch result:', isFresh);
  return isFresh;
}

// Mark that splash screen has been shown
export function markSplashShown() {
  console.log('📝 Marking splash as shown in session storage');
  sessionStorage.setItem('splashShown', 'true');
}

// Initialize splash screen and app
export function initializeSplashScreen() {
  console.log('🚀 Initializing splash screen...');
  const splashScreen = document.getElementById('splashScreen');
  const mainApp = document.getElementById('mainApp');
  
  if (!splashScreen || !mainApp) {
    console.warn('Splash screen elements not found, showing main app directly');
    showMainApp();
    return;
  }
  
  console.log('✅ Splash screen elements found');
  // Show splash screen initially
  splashScreen.style.display = 'flex';
  mainApp.classList.add('hidden');
  
  console.log(`⏰ Setting timeout for ${SPLASH_DURATION}ms`);
  // After the splash duration, transition to main app
  setTimeout(() => {
    console.log('⏰ Timeout fired, hiding splash screen...');
    hideSplashScreen();
  }, SPLASH_DURATION);
}

export function hideSplashScreen() {
  console.log('🎭 Hiding splash screen...');
  const splashScreen = document.getElementById('splashScreen');
  const mainApp = document.getElementById('mainApp');
  
  if (splashScreen) {
    console.log('✅ Splash screen element found, applying fade out');
    splashScreen.style.opacity = '0';
    splashScreen.style.transition = 'opacity 0.5s ease-out';
    
    setTimeout(() => {
      console.log('📱 Showing main app...');
      splashScreen.style.display = 'none';
      showMainApp();
    }, 500);
  } else {
    console.log('❌ Splash screen element not found, showing main app directly');
    showMainApp();
  }
}

export function showMainApp() {
  console.log('📱 showMainApp called');
  const mainApp = document.getElementById('mainApp');
  if (mainApp) {
    console.log('✅ Main app element found, showing it');
    mainApp.classList.remove('hidden');
    mainApp.style.opacity = '0';
    mainApp.style.transition = 'opacity 0.5s ease-in';
    
    // Trigger fade-in animation
    setTimeout(() => {
      mainApp.style.opacity = '1';
      console.log('✨ Main app fully visible');
    }, 50);
  } else {
    console.log('❌ Main app element not found');
  }
}
