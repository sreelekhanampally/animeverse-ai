import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";
import { DesktopSidebar, MobileSidebar } from "./Sidebar";

export function MainLayout() {
    return (
        <div className="min-h-screen">
            <Navbar />
            <MobileSidebar />
            <div className="mx-auto flex w-full max-w-[1600px]">
                <DesktopSidebar />
                <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
