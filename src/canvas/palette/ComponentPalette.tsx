import React, { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Component catalogue
// ---------------------------------------------------------------------------

export interface ComponentPaletteItem {
  label: string;
  componentClassId: string;
  category: 'Sources' | 'Transforms' | 'Destinations';
  icon: string; // unicode / emoji placeholder
}

const COMPONENT_ITEMS: ComponentPaletteItem[] = [
  // Sources
  { label: 'OLE DB Source', componentClassId: 'Microsoft.OLEDBSource', category: 'Sources', icon: '🗄️' },
  { label: 'Flat File Source', componentClassId: 'Microsoft.FlatFileSource', category: 'Sources', icon: '📄' },
  { label: 'Excel Source', componentClassId: 'Microsoft.ExcelSource', category: 'Sources', icon: '📊' },
  { label: 'ADO NET Source', componentClassId: 'Microsoft.ADONETSource', category: 'Sources', icon: '🔌' },
  { label: 'Raw File Source', componentClassId: 'Microsoft.RawFileSource', category: 'Sources', icon: '📦' },
  { label: 'XML Source', componentClassId: 'Microsoft.XmlSource', category: 'Sources', icon: '📰' },

  // Transforms
  { label: 'Derived Column', componentClassId: 'Microsoft.DerivedColumn', category: 'Transforms', icon: 'ƒ' },
  { label: 'Conditional Split', componentClassId: 'Microsoft.ConditionalSplit', category: 'Transforms', icon: '⑂' },
  { label: 'Lookup', componentClassId: 'Microsoft.Lookup', category: 'Transforms', icon: '🔍' },
  { label: 'Aggregate', componentClassId: 'Microsoft.Aggregate', category: 'Transforms', icon: 'Σ' },
  { label: 'Sort', componentClassId: 'Microsoft.Sort', category: 'Transforms', icon: '↕' },
  { label: 'Merge Join', componentClassId: 'Microsoft.MergeJoin', category: 'Transforms', icon: '⋈' },
  { label: 'Union All', componentClassId: 'Microsoft.UnionAll', category: 'Transforms', icon: '∪' },
  { label: 'Data Conversion', componentClassId: 'Microsoft.DataConversion', category: 'Transforms', icon: '🔄' },
  { label: 'Multicast', componentClassId: 'Microsoft.Multicast', category: 'Transforms', icon: '📡' },
  { label: 'Row Count', componentClassId: 'Microsoft.RowCount', category: 'Transforms', icon: '#' },
  { label: 'Script Component', componentClassId: 'Microsoft.ScriptComponent', category: 'Transforms', icon: '📝' },

  // Destinations
  { label: 'OLE DB Destination', componentClassId: 'Microsoft.OLEDBDestination', category: 'Destinations', icon: '🗄️' },
  { label: 'Flat File Destination', componentClassId: 'Microsoft.FlatFileDestination', category: 'Destinations', icon: '📄' },
  { label: 'Excel Destination', componentClassId: 'Microsoft.ExcelDestination', category: 'Destinations', icon: '📊' },
  { label: 'ADO NET Destination', componentClassId: 'Microsoft.ADONETDestination', category: 'Destinations', icon: '🔌' },
  { label: 'Raw File Destination', componentClassId: 'Microsoft.RawFileDestination', category: 'Destinations', icon: '📦' },
];

const CATEGORIES: ('Sources' | 'Transforms' | 'Destinations')[] = ['Sources', 'Transforms', 'Destinations'];

const CATEGORY_COLORS: Record<string, string> = {
  Sources: '#2196F3',
  Transforms: '#FF9800',
  Destinations: '#4CAF50',
};

const CATEGORY_ICONS: Record<string, string> = {
  Sources: '⬇',
  Transforms: '⚙',
  Destinations: '⬆',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ComponentPaletteProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const ComponentPalette: React.FC<ComponentPaletteProps> = ({ collapsed = false, onToggle }) => {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) { return COMPONENT_ITEMS; }
    const lower = filter.toLowerCase();
    return COMPONENT_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.componentClassId.toLowerCase().includes(lower)
    );
  }, [filter]);

  const handleDragStart = (e: React.DragEvent, item: ComponentPaletteItem) => {
    e.dataTransfer.setData('application/ssis-component-type', item.componentClassId);
    e.dataTransfer.setData('application/ssis-component-label', item.label);
    e.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <div className="ssis-palette ssis-palette--collapsed" onClick={onToggle} title="Expand Data Flow Toolbox">
        <span className="ssis-palette__toggle-icon">▶</span>
      </div>
    );
  }

  return (
    <div className="ssis-palette">
      <div className="ssis-palette__header">
        <span className="ssis-palette__title">Data Flow Toolbox</span>
        {onToggle && (
          <button className="ssis-palette__collapse-btn" onClick={onToggle} title="Collapse">
            ◀
          </button>
        )}
      </div>

      <div className="ssis-palette__search">
        <input
          type="text"
          placeholder="Search components…"
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
              <div
                className="ssis-palette__group-header ssis-df-palette__group-header"
                style={{ borderLeft: `3px solid ${CATEGORY_COLORS[category]}` }}
              >
                <span className="ssis-df-palette__category-icon">{CATEGORY_ICONS[category]}</span>
                {category}
              </div>
              {items.map((item) => (
                <div
                  key={item.componentClassId}
                  className="ssis-palette__item"
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  title={item.componentClassId}
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

export default ComponentPalette;
export { COMPONENT_ITEMS };
