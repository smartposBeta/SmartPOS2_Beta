import React, { useState } from 'react';
import { Camera, X, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Scanner from './Scanner';
import { useToast } from '@/hooks/use-toast';
import { LocalizedContent } from '@/contexts/LanguageContext';

interface BarcodeScannerButtonProps {
  onBarcodeScanned: (barcode: string) => void;
  onResult?: (barcode: string) => void; // Alias for onBarcodeScanned for compatibility
  disabled?: boolean;
  className?: string;
}

const BarcodeScannerButton: React.FC<BarcodeScannerButtonProps> = ({ 
  onBarcodeScanned, 
  onResult,
  disabled = false,
  className = ''
}) => {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const { toast } = useToast();

  const handleBarcodeScanned = (barcode: string) => {
    onBarcodeScanned(barcode);
    if (onResult) onResult(barcode);
    setIsScannerOpen(false);
    toast({
      title: 'Barcode Scanned',
      description: `Successfully scanned: ${barcode}`,
    });
  };

  const handleScannerError = (error: Error) => {
    console.error('Scanner error:', error);
    toast({
      title: 'Scanner Error',
      description: 'Failed to access camera. Please check permissions.',
      variant: 'destructive',
    });
  };

  return (
    <LocalizedContent>
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setIsScannerOpen(true)}
        disabled={disabled}
        className={`h-10 w-10 bg-[#FF8882] text-white border-[#FF8882] hover:bg-[#D89D9D] hover:border-[#D89D9D] ${className}`}
        data-testid="button-scan-barcode"
        title="Scan barcode with camera"
        style={{
          boxShadow: '0 2px 8px rgba(255, 136, 130, 0.3)',
        }}
      >
        <Camera className="h-4 w-4" />
      </Button>

      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <span>Scan Barcode</span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="mt-4">
            <Scanner
              onResult={handleBarcodeScanned}
              onError={handleScannerError}
            />
          </div>
          
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
              <Info className="h-4 w-4 text-blue-500" />
              <div>
                <p className="font-medium text-blue-700">How to scan:</p>
                <p className="text-blue-600">1. Point camera at barcode</p>
                <p className="text-blue-600">2. Hold steady until scanned</p>
                <p className="text-blue-600">3. Barcode will auto-fill</p>
              </div>
            </div>
            <p className="text-center text-sm text-gray-500">
              Supports: UPC, EAN, Code 128, Code 39, and more
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
    </LocalizedContent>
  );
};

export default BarcodeScannerButton;
