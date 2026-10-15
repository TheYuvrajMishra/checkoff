#!/usr/bin/env python3
"""
CheckOff — patch Gradle scripts that run node during configuration.

Several Expo/React Native Gradle scripts use `project.providers.exec` to run
`node` during configuration. This fails in CI for unknown reasons (works in
bash). Patch them to use hardcoded paths instead.

Also patches the expo-modules-autolinking mirror-kotlin-inline-modules command
to be a no-op, as it fails in CI when trying to write to node_modules.

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


def patch_mirror_kotlin():
    """Make mirror-kotlin-inline-modules a no-op (fails in CI) and pre-generate the expected output."""
    p = 'node_modules/expo-modules-autolinking/build/commands/mirrorKotlinInlineModulesCommand.js'
    try:
        with open(p) as f:
            s = f.read()
    except FileNotFoundError:
        print(f"{p} not found, skipping", file=sys.stderr)
        return False
    old_action = ".action(async (commandArguments) => {"
    new_action = ".action(async (commandArguments) => { return; /* patched: skip in CI */"
    if old_action in s and 'patched: skip in CI' not in s:
        s = s.replace(old_action, new_action, 1)
        with open(p, 'w') as f:
            f.write(s)
        print(f"patched: {p} (no-op)")
    elif 'patched: skip in CI' in s:
        print(f"already patched: {p}")
    else:
        print(f"action pattern not found in {p}", file=sys.stderr)
        return False
    # Pre-generate the empty ExpoInlineModulesList.java that the build expects
    import os
    out_dir = 'node_modules/expo/android/build/inline/modules'
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, 'ExpoInlineModulesList.java')
    content = """package inline.modules;

import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import expo.modules.kotlin.ModulesProvider;
import expo.modules.kotlin.modules.Module;
import expo.modules.kotlin.services.Service;

public class ExpoInlineModulesList implements ModulesProvider {

  @Override
  public Map<Class<? extends Module>, String> getModulesMap() {
    return Map.of(

    );
  }

  @Override
  public List<Class<? extends @NotNull Service>> getServices() {
    return new ArrayList<>();
  }
}

"""
    with open(out_file, 'w') as f:
        f.write(content)
    print(f"generated: {out_file}")
    return True


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
    if not patch_mirror_kotlin():
        failed = True
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
