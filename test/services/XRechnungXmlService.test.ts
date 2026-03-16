import { describe, it, expect } from 'vitest';
import { XRechnungXmlService } from '../../src/server/services/XRechnungXmlService.js';
import type { InvoiceDto } from '../../src/shared/types';

function sampleInvoice(): InvoiceDto {
  return {
    id: 1,
    invoiceNumber: 'XML-001',
    invoiceDate: '2024-06-20',
    invoiceTypeCode: '380',
    currencyCode: 'EUR',
    dueDate: '2024-07-20',
    seller: {
      name: 'XML Seller GmbH', street: 'Str 1', city: 'Berlin',
      postalCode: '10115', countryCode: 'DE', vatId: 'DE111111111',
      contactName: 'Max', contactPhone: '+49123', contactEmail: 'max@example.com',
    },
    buyer: {
      name: 'XML Buyer AG', street: 'Str 2', city: 'Munich',
      postalCode: '80331', countryCode: 'DE', email: 'buyer@example.com',
    },
    buyerReference: '04011000-1234512345-06',
    paymentMeansCode: '58',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    paymentTerms: 'Net 30 days',
    taxCategoryCode: 'S',
    taxRate: 19,
    kleinunternehmer: false,
    totalNetAmount: 100,
    totalTaxAmount: 19,
    totalGrossAmount: 119,
    amountDue: 119,
    lines: [
      { lineNumber: 1, quantity: 2, unitCode: 'C62', itemName: 'Widget', netPrice: 50, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 100 },
    ],
  };
}

describe('XRechnungXmlService', () => {
  const service = new XRechnungXmlService();

  it('should generate valid UBL 2.1 XML', () => {
    const xml = service.generate(sampleInvoice());

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"');
    expect(xml).toContain('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"');
  });

  it('should contain XRechnung CustomizationID', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
  });

  it('should contain invoice header fields', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:ID>XML-001</cbc:ID>');
    expect(xml).toContain('<cbc:IssueDate>2024-06-20</cbc:IssueDate>');
    expect(xml).toContain('<cbc:DueDate>2024-07-20</cbc:DueDate>');
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>');
  });

  it('should contain seller and buyer parties', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:RegistrationName>XML Seller GmbH</cbc:RegistrationName>');
    expect(xml).toContain('<cbc:RegistrationName>XML Buyer AG</cbc:RegistrationName>');
    expect(xml).toContain('<cbc:CompanyID>DE111111111</cbc:CompanyID>');
  });

  it('should contain payment information', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>');
    expect(xml).toContain('DE89370400440532013000');
    expect(xml).toContain('COBADEFFXXX');
    expect(xml).toContain('Net 30 days');
  });

  it('should contain tax and monetary totals', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>');
  });

  it('should contain line items', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:Name>Widget</cbc:Name>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">50.00</cbc:PriceAmount>');
  });

  it('should include §19 UStG note for Kleinunternehmer', () => {
    const inv = { ...sampleInvoice(), kleinunternehmer: true, taxCategoryCode: 'E', taxRate: 0, totalTaxAmount: 0, totalGrossAmount: 100, amountDue: 100 };
    const xml = service.generate(inv);
    expect(xml).toContain('§19 UStG');
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>vatex-eu-132-1b</cbc:TaxExemptionReasonCode>');
    expect(xml).toContain('<cbc:ID>E</cbc:ID>');
  });

  it('should NOT include §19 note for regular invoices', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).not.toContain('§19 UStG');
    expect(xml).not.toContain('TaxExemptionReasonCode');
  });

  it('should contain BT-30 CompanyID in PartyLegalEntity (BR-CO-26)', () => {
    const xml = service.generate(sampleInvoice());
    // BT-30 should appear inside PartyLegalEntity (after RegistrationName)
    const legalEntityMatch = xml.match(/<cac:PartyLegalEntity>[\s\S]*?<\/cac:PartyLegalEntity>/g);
    expect(legalEntityMatch).toBeTruthy();
    // Seller's PartyLegalEntity should contain CompanyID
    const sellerLegal = legalEntityMatch![0];
    expect(sellerLegal).toContain('<cbc:CompanyID>DE111111111</cbc:CompanyID>');
  });

  it('should use taxNumber as BT-30 when vatId is absent (BR-CO-26)', () => {
    const inv = sampleInvoice();
    inv.seller.vatId = undefined;
    inv.seller.taxNumber = '123/456/78901';
    const xml = service.generate(inv);
    const legalEntityMatch = xml.match(/<cac:PartyLegalEntity>[\s\S]*?<\/cac:PartyLegalEntity>/g);
    const sellerLegal = legalEntityMatch![0];
    expect(sellerLegal).toContain('<cbc:CompanyID>123/456/78901</cbc:CompanyID>');
  });

  it('should contain seller contact', () => {
    const xml = service.generate(sampleInvoice());
    expect(xml).toContain('<cbc:Name>Max</cbc:Name>');
    expect(xml).toContain('<cbc:Telephone>+49123</cbc:Telephone>');
    expect(xml).toContain('<cbc:ElectronicMail>max@example.com</cbc:ElectronicMail>');
  });
});
