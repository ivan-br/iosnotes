import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import type { Instrument } from "../market/types";
import { styles } from "./styles";

export const label = (instrument: Instrument) => {
  const pair = `${instrument.base}${instrument.quote}`;
  const suffix = instrument.symbol.startsWith(pair)
    ? instrument.symbol.slice(pair.length)
    : ` (${instrument.symbol})`;
  return `${instrument.base}/${instrument.quote}${suffix}`;
};
export const SymbolPicker = memo(function SymbolPicker({
  items,
  symbol,
  onSelect,
  closeKey,
  active,
}: {
  items: Instrument[];
  symbol: string;
  onSelect: (symbol: string) => void;
  closeKey: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState("");
  const [anchor, setAnchor] = useState({ x: 12, y: 0, width: 200 });
  const button = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const selected = items.find((item) => item.symbol === symbol);
  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
    setFilter("");
  };
  useEffect(() => {
    close();
  }, [closeKey, active]);
  useEffect(() => {
    const shown = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (event) => setKeyboardTop(event.endCoordinates.screenY),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardTop(null),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const availableHeight = Math.min(height, keyboardTop ?? height);
  const top = Math.max(12, Math.min(anchor.y, availableHeight - 172));
  const filtered = useMemo(() => {
    const query = filter.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return items.filter((item) =>
      item.symbol.replace(/[^A-Z0-9]/g, "").includes(query),
    );
  }, [filter, items]);
  return (
    <View style={styles.symbolSelector}>
      <Pressable
        ref={button}
        accessibilityRole="button"
        accessibilityLabel="Choose trading symbol"
        accessibilityState={{ expanded: open }}
        style={styles.dropdownButton}
        onPress={() => {
          Keyboard.dismiss();
          button.current?.measureInWindow(
            (x, y, measuredWidth, measuredHeight) => {
              setAnchor({ x, y: y + measuredHeight + 6, width: measuredWidth });
              setOpen(true);
            },
          );
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.dropdownLabel}
        >
          {selected ? label(selected) : symbol}
        </Text>
        <Text style={styles.dropdownChevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        statusBarTranslucent
        onDismiss={() => {
          if (Platform.OS !== "web") {
            const handle = findNodeHandle(button.current);
            if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
          }
        }}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityLabel="Close symbols"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
            }}
            onPress={close}
          />
          <View
            style={{
              marginTop: top,
              marginLeft: Math.max(
                12,
                Math.min(anchor.x, width - anchor.width - 12),
              ),
              width: Math.min(anchor.width, width - 24),
              maxHeight: Math.min(320, availableHeight - top - 12),
              backgroundColor: "#1b102c",
              borderColor: "#382652",
              borderWidth: 1,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <TextInput
              accessibilityLabel="Search symbols"
              value={filter}
              onChangeText={setFilter}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="ascii-capable"
              placeholder="Search symbol"
              placeholderTextColor="#75688c"
              style={styles.symbolSearch}
              returnKeyType="done"
              onSubmitEditing={close}
            />
            <FlatList
              data={filtered}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              keyExtractor={(item) => item.symbol}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={5}
              getItemLayout={(_, index) => ({
                length: 44,
                offset: 44 * index,
                index,
              })}
              ListEmptyComponent={
                <Text style={{ color: "#9b8db4", padding: 12 }}>Not found</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.symbol === symbol }}
                  onPress={() => {
                    close();
                    onSelect(item.symbol);
                  }}
                  style={[
                    styles.symbolOption,
                    { height: 44 },
                    symbol === item.symbol && styles.symbolOptionActive,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[
                      styles.symbolOptionText,
                      symbol === item.symbol && styles.symbolOptionTextActive,
                    ]}
                  >
                    {label(item)}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
});
