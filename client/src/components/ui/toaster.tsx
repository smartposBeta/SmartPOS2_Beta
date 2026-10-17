import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { LocalizedContent } from "@/contexts/LanguageContext"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={2000}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle><LocalizedContent>{title}</LocalizedContent></ToastTitle>}
              {description && (
                <ToastDescription><LocalizedContent>{description}</LocalizedContent></ToastDescription>
              )}
            </div>
            {action && <LocalizedContent>{action}</LocalizedContent>}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
