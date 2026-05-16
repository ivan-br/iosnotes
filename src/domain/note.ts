export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type CreateNoteInput = {
  title: string;
  body: string;
};
