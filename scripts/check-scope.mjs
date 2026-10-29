import tsModule from "typescript";
import fs from "fs";

const ts = tsModule.default || tsModule;
const html = fs.readFileSync("src/index.html", "utf8");
const script = html.split(/<script[\s>]/i)[2].split(/<\/script>/i)[0];

const sourceFile = ts.createSourceFile("temp.js", script, ts.ScriptTarget.ES2022, true);

// Walk all identifier nodes and find variables that are used but never declared in file or known globals
const declared = new Set([
  "window", "document", "navigator", "console", "localStorage", "sessionStorage",
  "fetch", "Math", "Date", "JSON", "Number", "String", "Array", "Set", "Map", "Object",
  "Intl", "crypto", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "AbortSignal", "WebSocket", "MutationObserver",
  "IntersectionObserver", "URL", "Blob", "Infinity", "NaN", "undefined", "Boolean",
  "Error", "TypeError", "RangeError", "SyntaxError", "performance", "scrollBy", "innerHeight", "innerWidth",
  "matchMedia", "addEventListener", "removeEventListener", "structuredClone", "queueMicrotask", "getComputedStyle"
]);

const used = new Set();

function addDeclaration(name) {
  if (name) declared.add(name);
}

function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    addDeclaration(node.name.text);
  } else if (ts.isFunctionDeclaration(node) && node.name) {
    addDeclaration(node.name.text);
  } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
    addDeclaration(node.name.text);
  } else if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
    addDeclaration(node.variableDeclaration.name.text);
  } else if (ts.isIdentifier(node)) {
    const parent = node.parent;
    // Check if it is a property access like obj.prop (where prop is not a variable)
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      // property name, skip
    } else if (ts.isPropertyAssignment(parent) && parent.name === node) {
      // object literal key, skip
    } else if (ts.isMethodDeclaration(parent) && parent.name === node) {
      // method name, skip
    } else {
      used.add({ name: node.text, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);

const missing = [];
for (const u of used) {
  if (!declared.has(u.name)) {
    missing.push(u);
  }
}

console.log("Missing identifiers count:", missing.length);
for (const m of missing) {
  console.log(`Line ${m.line}: ${m.name}`);
}
