import { useId, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { type, useTheme, type ThemePalette } from '../theme/tokens';

interface Props {
  children: string | number;
  variant?: keyof typeof type;
  palette?: ThemePalette;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * Silver/chrome metallic gradient text rendered via react-native-svg LinearGradient.
 * Uses a layout-measuring native Text so Flexbox sizing, font scaling, and 320dp
 * constraints work natively without fixed widths or text clipping.
 */
export function MetallicText({
  children,
  variant,
  palette: propPalette,
  style,
  containerStyle,
  numberOfLines = 1,
  adjustsFontSizeToFit = true,
  minimumFontScale = 0.7,
  align = 'left',
}: Props) {
  const currentTheme = useTheme();
  const theme = propPalette ?? currentTheme;
  const rawId = useId();
  const gradId = `metal_${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const variantStyle = variant && type[variant] ? type[variant] : undefined;
  const combinedStyle = [variantStyle, style];
  const flat = StyleSheet.flatten(combinedStyle) ?? {};
  const fontSize = typeof flat.fontSize === 'number' ? flat.fontSize : 24;
  const lineHeight = typeof flat.lineHeight === 'number' ? flat.lineHeight : Math.round(fontSize * 1.2);
  const fontWeight = flat.fontWeight ?? '700';
  const fontFamily = flat.fontFamily;
  const letterSpacing = typeof flat.letterSpacing === 'number' ? flat.letterSpacing : 0;

  const textStr = String(children);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - box.w) > 0.5 || Math.abs(height - box.h) > 0.5) {
      setBox({ w: Math.ceil(width), h: Math.ceil(height) });
    }
  };

  // If multiline text wraps onto >1 line, native Text handles wrapping cleanly.
  const isSingleLine = numberOfLines === 1 && box.h <= lineHeight * 1.45;
  const showSvg = box.w > 0 && box.h > 0 && isSingleLine;

  // Approximate character width check so SVG text scales down if container is narrow (e.g. 320dp)
  const approxCharWidth = fontSize * 0.58 + letterSpacing;
  const estimatedWidth = textStr.length * approxCharWidth;
  const fittedFontSize =
    adjustsFontSizeToFit && box.w > 0 && estimatedWidth > box.w
      ? Math.max(fontSize * minimumFontScale, (box.w / Math.max(1, textStr.length)) * 1.55)
      : fontSize;

  const xPos = align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0;
  const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const baselineY = Math.round(box.h * 0.78);

  return (
    <View style={[styles.wrap, containerStyle]}>
      <Text
        onLayout={onLayout}
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
        minimumFontScale={minimumFontScale}
        style={[
          style,
          {
            color: theme.text,
            textAlign: align,
            opacity: showSvg ? 0 : 1,
          },
        ]}
      >
        {textStr}
      </Text>
      {showSvg && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={box.w} height={box.h}>
            <Defs>
              <LinearGradient id={gradId} x1="0%" y1="0%" x2="15%" y2="100%">
                <Stop offset="0%" stopColor={theme.metallic[0]} stopOpacity="1" />
                <Stop offset="45%" stopColor={theme.metallic[1]} stopOpacity="1" />
                <Stop offset="78%" stopColor={theme.metallic[2]} stopOpacity="1" />
                <Stop offset="100%" stopColor={theme.metallic[3]} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <SvgText
              fill={`url(#${gradId})`}
              fontSize={fittedFontSize}
              fontWeight={fontWeight}
              fontFamily={fontFamily}
              letterSpacing={letterSpacing}
              x={xPos}
              y={baselineY}
              textAnchor={textAnchor}
            >
              {textStr}
            </SvgText>
          </Svg>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    flexShrink: 1,
  },
});
