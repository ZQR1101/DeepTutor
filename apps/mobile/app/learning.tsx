import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '../src/components/Screen';
import { spacing, useTheme } from '../src/theme/useTheme';

export default function LearningRoute() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Screen>
      <View style={[styles.header, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          学习记录
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回聊天"
          onPress={() => router.dismissTo('/chat')}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: theme.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M19 12H5m7-7-7 7 7 7"
              fill="none"
              stroke={theme.text}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 68,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  back: {
    position: 'absolute',
    start: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
