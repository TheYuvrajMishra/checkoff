/**
 * CheckOff — animated splash screen.
 *
 * Shows after the native splash hides: logo scales in with a spring,
 * the checkmark draws itself, then the whole thing fades out to reveal the app.
 * All animations run on the UI thread via Reanimated.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  createAnimatedComponent,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';

const AnimatedPath = createAnimatedComponent(Path);

// Checkmark path (matches the logo's check shape, simplified)
const CHECK_PATH = 'M 30 90 L 75 135 L 150 45';
const CHECK_LEN = 160;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const logoScale = useSharedValue(0.7);
  const logoOpacity = useSharedValue(0);
  const checkDraw = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  useEffect(() => {
    // Hide the native splash immediately; we take over with our animation.
    SplashScreen.hideAsync().catch(() => {});

    // Logo: spring in
    logoScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    logoOpacity.value = withTiming(1, { duration: 400 });

    // Checkmark: draw after logo lands
    checkDraw.value = withDelay(
      350,
      withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) })
    );

    // Fade out everything, then notify
    containerOpacity.value = withDelay(
      1600,
      withTiming(0, { duration: 400, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));

  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LEN * (1 - checkDraw.value),
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <Svg width={120} height={120} viewBox="0 0 180 180">
          <AnimatedPath
            d={CHECK_PATH}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECK_LEN}
            animatedProps={checkProps}
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
