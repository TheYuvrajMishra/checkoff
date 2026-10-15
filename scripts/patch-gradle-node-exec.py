#!/usr/bin/env python3
"""
CheckOff — patch Gradle scripts that run node during configuration.

Several Expo/React Native Gradle scripts use `project.providers.exec` to run
`node` during configuration. This fails in CI for unknown reasons (works in
bash). Patch them to use hardcoded paths instead.

Run after `npm ci` (node_modules must exist).
"""
import sys

PATCHES = [
    {
        'path': 'node_modules/expo-constants/scripts/get-app-config-android.gradle',
        'old': """def expoConstantsDir = project.providers.exec {
  workingDir(projectDir)
  commandLine("node", "-e", "console.log(require('path').dirname(require.resolve('expo-constants/package.json')));")
}.standardOutput.asText.get().trim()""",
        'new': """def expoConstantsDir = new File(rootProject.projectDir, "../node_modules/expo-constants").getCanonicalPath()""",
    },
    {
        'path': 'node_modules/react-native-screens/android/build.gradle',
        'old': """String maybeRnPackagePath = providers.exec {
        workingDir(rootDir)
        commandLine("node", "--print", "require.resolve('react-native/package.json')")
    }.standardOutput.asText.get().trim()""",
        'new': """String maybeRnPackagePath = new File(rootDir, "../node_modules/react-native/package.json").getCanonicalPath()""",
    },
    {
        'path': 'node_modules/react-native-svg/android/build.gradle',
        'old': """  def reactNativePackage = file(
      providers.exec {
          workingDir(rootDir)
          commandLine("node", "--print", "require.resolve('react-native/package.json')")
      }.standardOutput.asText.get().trim()
  )""",
        'new': """  def reactNativePackage = new File(rootDir, "../node_modules/react-native/package.json")""",
    },
]


def main() -> None:
    failed = False
    for p in PATCHES:
        try:
            with open(p['path']) as f:
                s = f.read()
        except FileNotFoundError:
            print(f"{p['path']} not found, skipping", file=sys.stderr)
            continue
        if p['new'] in s:
            print(f"already patched: {p['path']}")
            continue
        if p['old'] not in s:
            print(f"pattern not found in {p['path']}", file=sys.stderr)
            failed = True
            continue
        s = s.replace(p['old'], p['new'])
        with open(p['path'], 'w') as f:
            f.write(s)
        print(f"patched: {p['path']}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
