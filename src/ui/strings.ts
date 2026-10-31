/**
 * ALL user-facing text. Keep it honest: never "exact", never "accurate".
 */
export const STR = {
  appTitle: 'Wildfire Sim',
  honestyNotice: 'Simplified model. Not for real-world decisions.',
  honestyDetail:
    'Fire spread here is a simplified cellular model with Rothermel-inspired trends (wind, slope, fuel, moisture). It is not validated against real fires.',
  fallbackBanner: 'Fallback view: Google 3D tiles unavailable.',
  loadingArea: 'Loading demo area…',
  loadError: 'Could not load the demo area.',
  syntheticTag: 'synthetic',
  syntheticNote: 'Synthetic area: generated terrain and land cover, not a real place.',
  realNote: 'Land cover: © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles.',
  googleAttribution: 'Imagery: Google. Display only; never used as simulation data.',
  liveAreaLabel: 'Live (current view) — coming soon',
  liveAreaUnavailable: 'Live loading of the current view is coming soon. Pick a saved demo area.',
  debugOutline: 'Grid outline',
  debugFuel: 'Fuel classes',
  debugSlope: 'Slope',
  cameraTopDown: 'Top-down',
  cameraReset: 'Reset view',
  viewerMode: { google: '3D tiles: Google Photorealistic', fallback: '3D tiles: fallback (OpenStreetMap globe)' },
} as const;
