import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { PinGate, RouteGuard } from './AuthContext';

export function Layout() {
    return (
        <PinGate>
            <RouteGuard>
                <div className="app-container">
                    <Sidebar />
                    <main className="main-content">
                        <Outlet />
                    </main>
                </div>
            </RouteGuard>
        </PinGate>
    );
}
