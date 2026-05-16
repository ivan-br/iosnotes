import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Note } from '../src/domain/note';
import { getNotes } from '../src/storage/notesStorage';

export default function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadNotes() {
      try {
        setIsLoading(true);
        const storedNotes = await getNotes();

        if (isActive) {
          setNotes(storedNotes);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadNotes();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Notes</Text>
        <Pressable onPress={() => router.push('/create')} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>+ New Note</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/note/${item.id}`)} style={styles.noteItem}>
              <Text style={styles.noteTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.noteBody} numberOfLines={2}>
                {item.body || 'No body text'}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptyText}>Create your first local note.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: {
    color: '#25231f',
    fontSize: 30,
    fontWeight: '800',
  },
  primaryButton: {
    backgroundColor: '#2f6f73',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  list: {
    gap: 12,
    paddingBottom: 24,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  noteItem: {
    backgroundColor: '#ffffff',
    borderColor: '#e0ddd2',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  noteTitle: {
    color: '#25231f',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  noteBody: {
    color: '#6c675f',
    fontSize: 15,
    lineHeight: 21,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#25231f',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: '#6c675f',
    fontSize: 16,
  },
});
