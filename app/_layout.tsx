import type { ReactNode } from 'react';
import { Component } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#f7f5ef' },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#f7f5ef' },
          headerTitleStyle: { color: '#25231f', fontWeight: '700' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Notes' }} />
        <Stack.Screen name="create" options={{ title: 'New Note' }} />
        <Stack.Screen name="note/[id]" options={{ title: 'Note' }} />
      </Stack>
      <StatusBar style="dark" />
    </RootErrorBoundary>
  );
}

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{this.state.error.message}</Text>
          <Pressable onPress={() => this.setState({ error: null })} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>Try again</Text>
          </Pressable>
          <StatusBar style="dark" />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorContainer: {
    alignItems: 'center',
    backgroundColor: '#f7f5ef',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#25231f',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorText: {
    color: '#6c675f',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 18,
    textAlign: 'center',
  },
  errorButton: {
    backgroundColor: '#2f6f73',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
