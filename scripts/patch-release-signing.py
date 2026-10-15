#!/usr/bin/env python3
"""
CheckOff — patch android/app/build.gradle for release signing.

Run AFTER `expo prebuild` (which regenerates android/). Adds a `release`
signingConfigs block reading from gradle.properties (CHECKOFF_STORE_FILE,
CHECKOFF_STORE_PASSWORD, CHECKOFF_KEY_ALIAS, CHECKOFF_KEY_PASSWORD) and
points the release buildType at it.

The keystore itself is decoded from the ANDROID_KEYSTORE_BASE64 secret by
the workflow before this runs. Nothing secret is committed.
"""
import sys

GRADLE_PATH = 'android/app/build.gradle'

DEBUG_BLOCK = """        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }"""

RELEASE_BLOCK = """        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(findProperty('CHECKOFF_STORE_FILE') ?: 'checkoff-release.keystore')
            storePassword findProperty('CHECKOFF_STORE_PASSWORD') ?: ''
            keyAlias findProperty('CHECKOFF_KEY_ALIAS') ?: 'checkoff'
            keyPassword findProperty('CHECKOFF_KEY_PASSWORD') ?: ''
        }"""


def main() -> None:
    with open(GRADLE_PATH) as f:
        s = f.read()
    if 'signingConfigs.release' in s or "findProperty('CHECKOFF_STORE_FILE')" in s:
        print('release signing already configured, skipping')
        return
    if DEBUG_BLOCK not in s:
        print('debug signing block not found, cannot patch', file=sys.stderr)
        sys.exit(1)
    s = s.replace(DEBUG_BLOCK, RELEASE_BLOCK)
    # Point the release buildType at the release signing config. Expo's
    # template uses signingConfigs.debug for release; swap it. Scope the
    # search to the buildTypes block to avoid touching signingConfigs.
    bt_idx = s.find('buildTypes')
    if bt_idx == -1:
        print('buildTypes not found', file=sys.stderr)
        sys.exit(1)
    rel_idx = s.find('release {', bt_idx)
    if rel_idx == -1:
        print('release buildType not found', file=sys.stderr)
        sys.exit(1)
    head, tail = s[:rel_idx], s[rel_idx:]
    tail = tail.replace(
        'signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release', 1
    )
    s = head + tail
    with open(GRADLE_PATH, 'w') as f:
        f.write(s)
    print('release signing patched')


if __name__ == '__main__':
    main()
