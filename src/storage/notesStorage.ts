import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CreateNoteInput, Note } from '../domain/note';

const NOTES_STORAGE_KEY = 'notes:v1';

export async function getNotes(): Promise<Note[]> {
  let rawNotes: string | null = null;

  try {
    rawNotes = await AsyncStorage.getItem(NOTES_STORAGE_KEY);
  } catch {
    return [];
  }

  if (!rawNotes) {
    return [];
  }

  try {
    const notes = JSON.parse(rawNotes) as Note[];
    return Array.isArray(notes) ? sortNotes(notes) : [];
  } catch {
    return [];
  }
}

export async function getNote(id: string): Promise<Note | null> {
  const notes = await getNotes();
  return notes.find((note) => note.id === id) ?? null;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const notes = await getNotes();
  const note: Note = {
    id: createNoteId(),
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
  };

  await saveNotes([note, ...notes]);
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  const notes = await getNotes();
  await saveNotes(notes.filter((note) => note.id !== id));
}

async function saveNotes(notes: Note[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(sortNotes(notes)));
  } catch {
    throw new Error('Unable to save notes.');
  }
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
  );
}

function createNoteId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
