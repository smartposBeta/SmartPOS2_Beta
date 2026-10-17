import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';
import BarcodePreview from './BarcodePreview';
import { LocalizedContent } from '@/contexts/LanguageContext';

interface BarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  barcode: string | null;
}

const BarcodeModal: React.FC<BarcodeModalProps> = ({
  isOpen,
  onClose,
  productName,
  barcode,
}) => {
  const handleDownload = () => {
    const svg = document.querySelector('.barcode-preview svg') as SVGSVGElement;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const pngFile = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${productName.replace(/\s+/g, '_')}_barcode.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      }
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const svg = document.querySelector('.barcode-preview svg') as SVGSVGElement;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Barcode - ${productName}</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
            .container { text-align: center; border: 1px solid #eee; padding: 20px; border-radius: 8px; }
            h2 { margin-bottom: 20px; color: #333; }
            svg { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>${productName}</h2>
            ${svgData}
            <p>${barcode}</p>
          </div>
          <script>
            window.onload = () => {
              window.print();
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <LocalizedContent>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-white dark:bg-gray-800">
        <DialogHeader>
          <DialogTitle className="dark:text-white">{productName}</DialogTitle>
          <DialogDescription className="dark:text-gray-400">
            Barcode for manual identification or POS scanning
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center p-6 space-y-6">
          <div className="barcode-preview w-full overflow-hidden">
            <BarcodePreview value={barcode} width={2.5} height={120} />
          </div>
          <div className="flex gap-4 w-full">
            <Button 
              onClick={handleDownload} 
              className="flex-1 gap-2 bg-[#FF8882] hover:bg-[#FF7770]"
            >
              <Download className="w-4 h-4" />
              Download PNG
            </Button>
            <Button 
              onClick={handlePrint} 
              variant="outline"
              className="flex-1 gap-2 dark:text-white dark:border-gray-600"
            >
              <Printer className="w-4 h-4" />
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </LocalizedContent>
  );
};

export default BarcodeModal;
