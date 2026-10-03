import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import type { BookSession } from "../market/book-session";
import { validateStep } from "../market/decimal";
import { styles } from "./styles";

export const PriceStepInput = memo(function PriceStepInput({
  session,
}: {
  session: BookSession;
}) {
  const getStep = () => session.getProjection()?.step ?? session.book.step;
  const applied = useSyncExternalStore(session.subscribeData, getStep, getStep);
  const [draft, setDraft] = useState(applied),
    [error, setError] = useState("");
  const dirty = useRef(false),
    input = useRef<TextInput>(null);
  useEffect(() => {
    if (!dirty.current) setDraft(applied);
  }, [applied]);
  const apply = () => {
    try {
      const valid = validateStep(draft, session.venue.instrument.tick);
      session.setStep(valid);
      setDraft(valid);
      setError("");
      dirty.current = false;
      input.current?.blur();
      Keyboard.dismiss();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Invalid price step",
      );
    }
  };
  return (
    <View style={styles.rangeInputWrap}>
      <Text style={styles.inputLabel}>Price step</Text>
      <TextInput
        ref={input}
        accessibilityLabel="Price step"
        value={draft}
        keyboardType="decimal-pad"
        maxLength={32}
        autoCorrect={false}
        onTouchStart={(event) => event.stopPropagation()}
        onChangeText={(value) => {
          dirty.current = true;
          setDraft(value);
          setError("");
        }}
        onSubmitEditing={apply}
        returnKeyType="done"
        style={styles.rangeInput}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply price step"
        onPress={apply}
        style={styles.applyButton}
      >
        <Text style={styles.applyButtonText}>Apply</Text>
      </Pressable>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: "#ff737f", fontSize: 11, marginTop: 4 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
});
