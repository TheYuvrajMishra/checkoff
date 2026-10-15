#!/usr/bin/env python3
"""
CheckOff — patch expo-constants Gradle script.

The expo-constants Gradle script runs `node` during Gradle configuration
(via project.providers.exec) to locate its own directory. This fails in
CI for unknown reasons (works in local bash). Patch it to use a hardcoded
path instead.

Run after `npm ci` (node_modules must exist).
"""
import sys

PATH = 'node_modules/expo-constants/scripts/get-app-config-android.gradle'

OLD = """def expoConstantsDir = project.providers.exec {
  workingDir(projectDir)
  commandLine("node", "-e", "console.log(require('path').dirname(require.resolve('expo-constants/package.json')));")
}.standardOutput.asText.get().trim()"""

NEW = """def expoConstantsDir = new File(rootProject.projectDir, "../node_modules/expo-constants").getCanonicalPath()"""


def main() -> None:
    try:
        with open(PATH) as f:
            s = f.read()
    except FileNotFoundError:
        print(f'{PATH} not found, skipping', file=sys.stderr)
        sys.exit(1)
    if 'new File(rootProject.projectDir, "../node_modules/expo-constants")' in s:
        print('already patched, skipping')
        return
    if OLD not in s:
        print('pattern not found, cannot patch', file=sys.stderr)
        sys.exit(1)
    s = s.replace(OLD, NEW)
    with open(PATH, 'w') as f:
        f.write(s)
    print('patched expo-constants gradle script')


if __name__ == '__main__':
    main()
