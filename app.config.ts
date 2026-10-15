import { ExpoConfig, ConfigContext } from 'expo/config';
// @ts-ignore - app.json has no types
import base from './app.json';

// Versioning: CI injects these via env (GITHUB_RUN_NUMBER).
// Local builds fall back to dev defaults.
const runNumber = process.env.APP_VERSION_CODE || process.env.GITHUB_RUN_NUMBER;
const versionCode = runNumber ? parseInt(runNumber, 10) : 1;
const versionName = process.env.APP_VERSION_NAME || (runNumber ? `1.0.${runNumber}` : '1.0.0');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(base as any).expo,
  ...config,
  version: versionName,
  android: {
    ...(base as any).expo.android,
    versionCode,
  },
  ios: {
    ...(base as any).expo.ios,
    buildNumber: String(versionCode),
  },
});
