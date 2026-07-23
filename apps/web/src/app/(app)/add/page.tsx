import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddUrlForm } from "./url-form";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Add video — EFFEN Studio" };

export default function AddPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Add a video</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Adding a video collects metadata only — nothing is analyzed (and nothing
        costs money) until you select it for analysis in the library.
      </p>
      <Tabs defaultValue="url" className="mt-6">
        <TabsList>
          <TabsTrigger value="url">Paste a link</TabsTrigger>
          <TabsTrigger value="upload">Upload a file</TabsTrigger>
        </TabsList>
        <TabsContent value="url" className="mt-4">
          <AddUrlForm />
        </TabsContent>
        <TabsContent value="upload" className="mt-4">
          <UploadForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
