import { describe, it, expect } from "vitest";
import { maskCustomerName, maskDocument } from "@/lib/privacy";
import { duracaoMs, taxaMbps } from "../../supabase/functions/_shared/mikrotik";

describe("máscaras da fatura pública", () => {
  it("nome: primeiro nome + iniciais", () => {
    expect(maskCustomerName("Maria da Silva Souza")).toBe("Maria D. S. S.");
    expect(maskCustomerName("Ana")).toBe("Ana");
    expect(maskCustomerName("")).toBe("Cliente");
  });
  it("nome já mascarado não muda (a fatura-publica mascara antes)", () => {
    expect(maskCustomerName(maskCustomerName("João Pereira Lima"))).toBe("João P. L.");
  });
  it("CPF/CNPJ mostram só os 2 últimos dígitos", () => {
    expect(maskDocument("123.456.789-10")).toBe("***.***.***-10");
    expect(maskDocument("12.345.678/0001-90")).toBe("**.***.***/****-90");
    expect(maskDocument("00000000010")).toBe("***.***.***-10"); // formato enviado pela fatura-publica
    expect(maskDocument(null)).toBe("Não informado");
  });
});

describe("leitura dos valores do RouterOS", () => {
  it("durações do ping", () => {
    expect(duracaoMs("1ms234us")).toBeCloseTo(1.234);
    expect(duracaoMs("12ms")).toBe(12);
    expect(duracaoMs("345us")).toBeCloseTo(0.345);
    expect(duracaoMs("1s5ms")).toBe(1005);
    expect(duracaoMs("")).toBeNull();
  });
  it("limites da fila em Mbps", () => {
    expect(taxaMbps("100M")).toBe(100);
    expect(taxaMbps("1G")).toBe(1000);
    expect(taxaMbps("512k")).toBeCloseTo(0.512);
    expect(taxaMbps("50000000")).toBe(50);
    expect(taxaMbps("")).toBeNull();
  });
});
