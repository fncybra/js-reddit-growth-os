import React from 'react';
import { Tasks } from './Tasks';

export function VADashboard() {
    return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', padding: '0 0 32px' }}>
            <div style={{ padding: '20px 24px 0', maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ marginBottom: '16px' }}>
                    <h1 className="page-title" style={{ marginBottom: '6px' }}>VA Dashboard</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Worker view for current Reddit posting tasks.
                    </div>
                </div>
                <Tasks />
            </div>
        </div>
    );
}
