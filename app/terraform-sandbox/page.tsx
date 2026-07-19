'use client'

import { Header } from '@/components/dashboard/header';
import { TerraformSandbox } from '@/components/dashboard/terraform-sandbox';
import { Sidebar } from '@/components/dashboard/sidebar';

export default function TerraformSandboxPage() {
  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-60 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6">
            <TerraformSandbox />
          </div>
        </main>
      </div>
    </div>
  );
}
