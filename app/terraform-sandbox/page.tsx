import { Header } from '@/components/dashboard/header';
import { TerraformSandbox } from '@/components/dashboard/terraform-sandbox';

export const metadata = {
  title: 'Terraform Sandbox - AWS CloudPilot',
  description: 'Agentic Sandbox - Terraform Console for infrastructure optimization',
};

export default function TerraformSandboxPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header fullWidth showBrand />
      <main className="pt-16">
        <div className="px-6 py-6">
          <TerraformSandbox />
        </div>
      </main>
    </div>
  );
}
