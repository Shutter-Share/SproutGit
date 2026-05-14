export type EditorInfo = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
};

export type GitToolInfo = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  supportsDiff: boolean;
  supportsMerge: boolean;
};
