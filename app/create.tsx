import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createNote } from '../src/storage/notesStorage';

export default function CreateNoteScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');

      const note = await createNote({
        title: trimmedTitle,
        body: body.trim(),
      });

      router.replace(`/note/${note.id}`);
    } catch {
      setError('Could not save the note.');
      setIsSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.form}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            if (error) {
              setError('');
            }
          }}
          placeholder="Note title"
          placeholderTextColor="#9b958b"
          style={[styles.input, error ? styles.inputError : null]}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Body</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Write something..."
          placeholderTextColor="#9b958b"
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.bodyInput]}
        />

        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.saveButton,
            pressed || isSaving ? styles.saveButtonPressed : null,
          ]}
        >
          <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Note'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  form: {
    gap: 10,
  },
  label: {
    color: '#403c35',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d8d3c7',
    borderRadius: 8,
    borderWidth: 1,
    color: '#25231f',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputError: {
    borderColor: '#b03a2e',
  },
  bodyInput: {
    minHeight: 180,
    lineHeight: 22,
  },
  error: {
    color: '#b03a2e',
    fontSize: 14,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#2f6f73',
    borderRadius: 8,
    marginTop: 18,
    paddingVertical: 14,
  },
  saveButtonPressed: {
    opacity: 0.75,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
