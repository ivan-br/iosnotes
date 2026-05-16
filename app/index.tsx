import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

type ScreenMode = 'home' | 'camera' | 'result';

const SCAN_DELAY_MS = 1200;

export default function HomeScreen() {
  const cameraRef = useRef<CameraView>(null);
  const captureStartedRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<ScreenMode>('home');
  const [cameraReady, setCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanError, setScanError] = useState('');
  const [frameWidth, setFrameWidth] = useState(0);
  const [sliderX, setSliderX] = useState(0);
  const { width } = useWindowDimensions();

  const resultFrameWidth = Math.min(width - 32, 390);

  useEffect(() => {
    if (frameWidth > 0 && sliderX === 0) {
      setSliderX(frameWidth / 2);
    }
  }, [frameWidth, sliderX]);

  useEffect(() => {
    if (mode !== 'camera' || !cameraReady || !permission?.granted) {
      return;
    }

    const timer = setTimeout(() => {
      captureScan();
    }, SCAN_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [cameraReady, mode, permission?.granted]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => updateSlider(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateSlider(event.nativeEvent.locationX),
      }),
    [frameWidth]
  );

  async function startScan() {
    setScanError('');

    if (!permission?.granted) {
      const nextPermission = await requestPermission();

      if (!nextPermission.granted) {
        setScanError('Camera access is required to scan your face.');
        return;
      }
    }

    captureStartedRef.current = false;
    setCameraReady(false);
    setMode('camera');
  }

  async function captureScan() {
    if (captureStartedRef.current || !cameraRef.current) {
      return;
    }

    captureStartedRef.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });

      setPhotoUri(photo.uri);
      setMode('result');
    } catch {
      captureStartedRef.current = false;
      setScanError('Scan failed. Try again.');
      setMode('home');
    }
  }

  function updateSlider(nextX: number) {
    if (frameWidth <= 0) {
      return;
    }

    setSliderX(Math.min(Math.max(nextX, 0), frameWidth));
  }

  function resetScan() {
    captureStartedRef.current = false;
    setCameraReady(false);
    setPhotoUri(null);
    setScanError('');
    setMode('home');
  }

  if (mode === 'camera') {
    return (
      <View style={styles.container}>
        <View style={styles.cameraShell}>
          <CameraView
            active
            facing="front"
            mirror
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
            ref={cameraRef}
            style={styles.camera}
          />
        </View>
        <Text style={styles.scanText}>{cameraReady ? 'Scanning...' : 'Opening camera...'}</Text>
      </View>
    );
  }

  if (mode === 'result' && photoUri) {
    return (
      <View style={styles.resultContainer}>
        <View
          {...panResponder.panHandlers}
          onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
          style={[styles.resultFrame, { width: resultFrameWidth }]}
        >
          <Image source={{ uri: photoUri }} resizeMode="cover" style={styles.resultImage} />
          <View pointerEvents="none" style={[styles.sliderLine, { left: sliderX }]} />
          <View pointerEvents="none" style={[styles.sliderHandle, { left: sliderX - 18 }]}>
            <View style={styles.handleBar} />
            <View style={styles.handleBar} />
          </View>
        </View>

        <Pressable onPress={resetScan} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>Scan again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={startScan} style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}>
        <Text style={styles.scanButtonText}>Scan your face</Text>
      </Pressable>
      {scanError ? <Text style={styles.errorText}>{scanError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  resultContainer: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: '#1268ff',
    borderRadius: 22,
    minHeight: 92,
    justifyContent: 'center',
    maxWidth: 360,
    paddingHorizontal: 28,
    width: '100%',
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
  errorText: {
    color: '#ff5b5b',
    fontSize: 15,
    marginTop: 18,
    textAlign: 'center',
  },
  cameraShell: {
    borderColor: '#1268ff',
    borderRadius: 150,
    borderWidth: 3,
    height: 300,
    overflow: 'hidden',
    width: 300,
  },
  camera: {
    flex: 1,
  },
  scanText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 22,
  },
  resultFrame: {
    aspectRatio: 0.72,
    backgroundColor: '#111111',
    borderColor: '#1f1f1f',
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: '78%',
    overflow: 'hidden',
  },
  resultImage: {
    height: '100%',
    width: '100%',
  },
  sliderLine: {
    backgroundColor: '#ffffff',
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  sliderHandle: {
    alignItems: 'center',
    backgroundColor: '#1268ff',
    borderColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 5,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    top: '50%',
    width: 36,
  },
  handleBar: {
    backgroundColor: '#ffffff',
    borderRadius: 2,
    height: 16,
    width: 3,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#1268ff',
    borderRadius: 16,
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
});
