import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publicBaseUrl } from "@/lib/config";
import { NewDeviceForm } from "../../../_components/forms";

export default function NewDevicePage() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Add a device</CardTitle>
        <CardDescription>
          Name it after the PC so you can tell devices apart in usage and audit history. You&apos;ll get a one-time setup
          command to run on that PC — after that, plain <code>claude</code> just works there.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <NewDeviceForm baseUrl={publicBaseUrl()} />
      </CardContent>
    </Card>
  );
}
