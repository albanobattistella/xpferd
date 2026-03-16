import type { Request, Response } from 'express';
import { InvoiceService } from '../services/InvoiceService.js';
import { XRechnungXmlService } from '../services/XRechnungXmlService.js';

export class ExportController {
  private invoiceService = new InvoiceService();
  private xmlService = new XRechnungXmlService();

  exportXml = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const invoice = this.invoiceService.getById(id);
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const xml = this.xmlService.generate(invoice);
    const filename = `xrechnung-${invoice.invoiceNumber}.xml`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  };
}
