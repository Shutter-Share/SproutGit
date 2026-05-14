import { create } from 'zustand';
import type { UpdateState } from '@sproutgit/ui';

interface UpdateStore {
  updateState: UpdateState;
  setUpdateState: (state: UpdateState) => void;
}

export const useUpdateStore = create<UpdateStore>()((set) => ({
  updateState: { status: 'idle' },
  setUpdateState: (state) => set({ updateState: state }),
}));
