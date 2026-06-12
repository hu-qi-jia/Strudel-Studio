import { Modal } from '../Modal';
import { SettingsTab } from './SettingsTab';
import { useSettings, setIsPanelOpened } from '../../../settings.mjs';

export function SettingsModal({ context }) {
  const { isPanelOpen } = useSettings();

  return (
    <Modal
      isOpen={isPanelOpen}
      onClose={() => setIsPanelOpened(false)}
      title="settings"
    >
      <SettingsTab started={context.started} />
    </Modal>
  );
}
