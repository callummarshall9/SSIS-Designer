import React, { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Task catalogue
// ---------------------------------------------------------------------------

export interface PaletteItem {
  label: string;
  executableType: string;
  category: 'Common' | 'Containers' | 'Other Tasks';
  icon: string; // unicode / emoji placeholder
}

const PALETTE_ITEMS: PaletteItem[] = [
  // Common
  { label: 'Execute SQL Task', executableType: 'Microsoft.ExecuteSQLTask', category: 'Common', icon: '🗄️' },
  { label: 'Data Flow Task', executableType: 'Microsoft.Pipeline', category: 'Common', icon: '⇅' },
  { label: 'Script Task', executableType: 'Microsoft.ScriptTask', category: 'Common', icon: '📝' },
  { label: 'Execute Package Task', executableType: 'Microsoft.ExecutePackageTask', category: 'Common', icon: '📦' },
  { label: 'Expression Task', executableType: 'Microsoft.ExpressionTask', category: 'Common', icon: 'ƒ' },

  // Containers
  { label: 'For Loop Container', executableType: 'STOCK:FORLOOP', category: 'Containers', icon: '🔁' },
  { label: 'For Each Loop Container', executableType: 'STOCK:FOREACHLOOP', category: 'Containers', icon: '🔂' },
  { label: 'Sequence Container', executableType: 'STOCK:SEQUENCE', category: 'Containers', icon: '▤' },

  // Other Tasks
  { label: 'Execute Process Task', executableType: 'Microsoft.ExecuteProcess', category: 'Other Tasks', icon: '⚙️' },
  { label: 'File System Task', executableType: 'Microsoft.FileSystemTask', category: 'Other Tasks', icon: '📁' },
  { label: 'FTP Task', executableType: 'Microsoft.FtpTask', category: 'Other Tasks', icon: '🌐' },
  { label: 'Send Mail Task', executableType: 'Microsoft.SendMailTask', category: 'Other Tasks', icon: '✉️' },
];

const CATEGORIES: ('Common' | 'Containers' | 'Other Tasks')[] = ['Common', 'Containers', 'Other Tasks'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TaskPaletteProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const TaskPalette: React.FC<TaskPaletteProps> = ({ collapsed = false, onToggle }) => {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) { return PALETTE_ITEMS; }
    const lower = filter.toLowerCase();
    return PALETTE_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.executableType.toLowerCase().includes(lower)
    );
  }, [filter]);

  const handleDragStart = (e: React.DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData('application/ssis-task-type', item.executableType);
    e.dataTransfer.setData('application/ssis-task-label', item.label);
    e.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <div className="ssis-palette ssis-palette--collapsed" onClick={onToggle} title="Expand Toolbox">
        <span className="ssis-palette__toggle-icon">▶</span>
      </div>
    );
  }

  return (
    <div className="ssis-palette">
      <div className="ssis-palette__header">
        <span className="ssis-palette__title">SSIS Toolbox</span>
        {onToggle && (
          <button className="ssis-palette__collapse-btn" onClick={onToggle} title="Collapse">
            ◀
          </button>
        )}
      </div>

      <div className="ssis-palette__search">
        <input
          type="text"
          placeholder="Search tasks…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ssis-palette__search-input"
        />
      </div>

      <div className="ssis-palette__list">
        {CATEGORIES.map((category) => {
          const items = filtered.filter((i) => i.category === category);
          if (items.length === 0) { return null; }
          return (
            <div key={category} className="ssis-palette__group">
              <div className="ssis-palette__group-header">{category}</div>
              {items.map((item) => (
                <div
                  key={item.executableType}
                  className="ssis-palette__item"
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  title={item.executableType}
                >
                  <span className="ssis-palette__item-icon">{item.icon}</span>
                  <span className="ssis-palette__item-label">{item.label}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TaskPalette;
export { PALETTE_ITEMS };
