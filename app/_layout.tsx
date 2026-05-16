import type { ReactNode } from 'react';
import { Component, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  clearError,
  getCurrentError,
  installGlobalErrorHandler,
  reportError,
  subscribeToErrors,
} from '../src/runtime/errorStore';

installGlobalErrorHandler();

export default function RootLayout() {
  const [runtimeError, setRuntimeError] = useState<Error | null>(() => getCurrentError());

  useEffect(() => subscribeToErrors(setRuntimeError), []);

  if (runtimeError) {
    return (
      <ErrorFallback
        error={runtimeError}
        onRetry={() => {
          clearError();
          setRuntimeError(null);
        }}
      />
    );
  }

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

type ErrorFallbackProps = {
  error: Error;
  onRetry: () => void;
};

function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorText}>{error.message}</Text>
      <Pressable onPress={onRetry} style={styles.errorButton}>
        <Text style={styles.errorButtonText}>Try again</Text>
      </Pressable>
      <StatusBar style="dark" />
    </View>
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

  componentDidCatch(error: Error) {
    reportError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />
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
