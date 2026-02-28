import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Info, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { generateManagerActionItems } from '../services/growthEngine';

const priorityConfig = {
    critical: { color: '#f44336', icon: AlertCircle, label: 'critical' },
    warning:  { color: '#ff9800', icon: AlertTriangle, label: 'warning' },
    info:     { color: '#9e9e9e', icon: Info, label: 'info' },
    success:  { color: '#4caf50', icon: CheckCircle, label: 'success' },
};

export function ManagerActionItems({ accounts }) {
    const [collapsed, setCollapsed] = useState(false);
    const [dismissedIds, setDismissedIds] = useState(new Set());

    const allItems = generateManagerActionItems(accounts);

    // Filter out dismissed success items
    const items = allItems.filter(item =>
        !(item.priority === 'success' && dismissedIds.has(`${item.accountId}-${item.rule}`))
    );

    // Count badges
    const counts = {};
    for (const item of items) {
        counts[item.priority] = (counts[item.priority] || 0) + 1;
    }

    const dismissSuccess = (accountId, rule) => {
        setDismissedIds(prev => {
            const next = new Set(prev);
            next.add(`${accountId}-${rule}`);
            return next;
        });
    };

    if (items.length === 0 && allItems.length === 0) return null;

    return (
        <div className="card" style={{ padding: '0', marginBottom: '20px' }}>
            {/* Header */}
            <div
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                    borderBottom: collapsed ? 'none' : '1px solid var(--border-color)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    <span style={{ fontWeight: 600, fontSize: '1rem' }}>Manager Action Items</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>({items.length})</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', fontSize: '0.75rem' }}>
                    {counts.critical > 0 && (
                        <span style={{ color: '#f44336', fontWeight: 600 }}>{counts.critical} critical</span>
                    )}
                    {counts.warning > 0 && (
                        <span style={{ color: '#ff9800', fontWeight: 600 }}>{counts.warning} warning{counts.warning !== 1 ? 's' : ''}</span>
                    )}
                    {counts.info > 0 && (
                        <span style={{ color: '#9e9e9e' }}>{counts.info} info</span>
                    )}
                    {counts.success > 0 && (
                        <span style={{ color: '#4caf50' }}>{counts.success} ready</span>
                    )}
                </div>
            </div>

            {/* Items List */}
            {!collapsed && (
                <div style={{ padding: '4px 0' }}>
                    {items.map((item, idx) => {
                        const config = priorityConfig[item.priority] || priorityConfig.info;
                        const Icon = config.icon;
                        return (
                            <div
                                key={`${item.accountId}-${item.rule}-${idx}`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '10px 20px',
                                    gap: '12px',
                                    borderBottom: idx < items.length - 1 ? '1px solid var(--border-color)' : 'none',
                                }}
                            >
                                <Icon size={16} style={{ color: config.color, flexShrink: 0 }} />
                                <Link
                                    to={`/account/${item.accountId}`}
                                    style={{
                                        flex: 1,
                                        color: 'var(--text-primary)',
                                        textDecoration: 'none',
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {item.message}
                                </Link>
                                {item.priority === 'success' && (
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            dismissSuccess(item.accountId, item.rule);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                        }}
                                        title="Dismiss"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
