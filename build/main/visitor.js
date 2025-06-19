"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SWRVisitor = void 0;
const visitor_plugin_common_1 = require("@graphql-codegen/visitor-plugin-common");
const graphql_1 = require("graphql");
const micromatch_1 = __importDefault(require("micromatch"));
const pascal_case_1 = require("pascal-case");
const composeQueryHandler = (operation, config) => {
    const codes = [];
    const { node } = operation;
    const optionalVariables = !node.variableDefinitions ||
        node.variableDefinitions.length === 0 ||
        node.variableDefinitions.every((v) => v.type.kind !== graphql_1.Kind.NON_NULL_TYPE || v.defaultValue)
        ? '?'
        : '';
    const name = node.name.value;
    const pascalName = (0, pascal_case_1.pascalCase)(node.name.value);
    const responseType = config.rawRequest
        ? `SWRRawResponse<${operation.operationResultType}>`
        : operation.operationResultType;
    const variablesType = operation.operationVariablesTypes;
    codes.push(`use${pascalName}(${config.autogenKey ? '' : 'key: SWRKeyInterface, '}variables?: ${variablesType} | null, config?: SWRConfigInterface<${responseType}, ClientError>,
  requestHeaders?: RequestInit["headers"]) {
  return useSWR<${responseType}, ClientError>(${config.autogenKey
        ? `variables && genKey<${variablesType}>('${pascalName}', variables)`
        : 'key'}, () => sdk.${name}(variables!, requestHeaders), config);
}`);
    if (config.infinite) {
        codes.push(`use${pascalName}Infinite(${config.autogenKey ? '' : 'id: string, '}getKey: ${config.typesPrefix}SWRInfiniteKeyLoader${config.typesSuffix}<${responseType}, ${variablesType}>, variables${optionalVariables}: ${variablesType}, config?: SWRInfiniteConfiguration<${responseType}, ClientError>) {
  return useSWRInfinite<${responseType}, ClientError>(
    utilsForInfinite.generateGetKey<${responseType}, ${variablesType}>(${config.autogenKey
            ? `genKey<${variablesType}>('${pascalName}', variables)`
            : 'id'}, getKey),
    utilsForInfinite.generateFetcher<${responseType}, ${variablesType}>(sdk.${name}, variables),
    config);
}`);
    }
    return codes;
};
class SWRVisitor extends visitor_plugin_common_1.ClientSideBaseVisitor {
    _operationsToInclude = [];
    _enabledInfinite = false;
    constructor(schema, fragments, rawConfig) {
        super(schema, fragments, rawConfig, {
            excludeQueries: rawConfig.excludeQueries || null,
            useSWRInfinite: rawConfig.useSWRInfinite || null,
            autogenSWRKey: rawConfig.autogenSWRKey || false,
        });
        this._enabledInfinite =
            (this.config.useSWRInfinite &&
                typeof this.config.useSWRInfinite === 'string') ||
                (Array.isArray(this.config.useSWRInfinite) &&
                    this.config.useSWRInfinite.length > 0);
        const typeImport = this.config.useTypeImports ? 'import type' : 'import';
        this._additionalImports.push(`${typeImport} { ClientError } from 'graphql-request';`);
        if (this.config.useTypeImports) {
            if (this._enabledInfinite) {
                this._additionalImports.push(`import type { SWRConfiguration as SWRConfigInterface, Key as SWRKeyInterface } from 'swr';`);
                this._additionalImports.push(`import type { SWRInfiniteConfiguration } from 'swr/infinite';`);
                this._additionalImports.push(`import useSWR from 'swr';`);
                this._additionalImports.push(`import useSWRInfinite from 'swr/infinite';`);
            }
            else {
                this._additionalImports.push(`import type { SWRConfiguration as SWRConfigInterface, Key as SWRKeyInterface } from 'swr';`);
                this._additionalImports.push(`import useSWR from 'swr';`);
            }
        }
        else if (this._enabledInfinite) {
            this._additionalImports.push(`import useSWR, { SWRConfiguration as SWRConfigInterface, Key as SWRKeyInterface } from 'swr';`);
            this._additionalImports.push(`import useSWRInfinite, { SWRInfiniteConfiguration } from 'swr/infinite';`);
        }
        else {
            this._additionalImports.push(`import useSWR, { SWRConfiguration as SWRConfigInterface, Key as SWRKeyInterface } from 'swr';`);
        }
    }
    buildOperation(node, documentVariableName, operationType, operationResultType, operationVariablesTypes) {
        this._operationsToInclude.push({
            node,
            documentVariableName,
            operationType,
            operationResultType,
            operationVariablesTypes,
        });
        return null;
    }
    get sdkContent() {
        const codes = [];
        const { config } = this;
        const disabledexcludeQueries = !config.excludeQueries ||
            (Array.isArray(config.excludeQueries) && !config.excludeQueries.length);
        const allPossibleActions = this._operationsToInclude
            .filter((o) => {
            if (o.operationType !== 'Query') {
                return false;
            }
            if (disabledexcludeQueries) {
                return true;
            }
            return !micromatch_1.default.isMatch(o.node.name.value, config.excludeQueries);
        })
            .map((o) => composeQueryHandler(o, {
            autogenKey: config.autogenSWRKey,
            infinite: this._enabledInfinite &&
                micromatch_1.default.isMatch(o.node.name.value, config.useSWRInfinite),
            rawRequest: config.rawRequest,
            typesPrefix: config.typesPrefix,
            typesSuffix: config.typesSuffix,
        }))
            .reduce((p, c) => p.concat(c), [])
            .map((s) => (0, visitor_plugin_common_1.indentMultiline)(s, 2));
        // Add type of SWRRawResponse
        if (config.rawRequest) {
            codes.push(`type SWRRawResponse<Data = any> = { data?: Data | undefined; extensions?: any; headers: Headers; status: number; errors?: GraphQLError[] | undefined; };`);
        }
        // Add type of SWRInfiniteKeyLoader
        if (this._enabledInfinite) {
            codes.push(`export type ${config.typesPrefix}SWRInfiniteKeyLoader${config.typesSuffix}<Data = unknown, Variables = unknown> = (
  index: number,
  previousPageData: Data | null
) => [keyof Variables, Variables[keyof Variables] | null] | null;`);
        }
        // Add getSdkWithHooks function
        codes.push(`export function getSdkWithHooks(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  const sdk = getSdk(client, withWrapper);`);
        // Add the utility for useSWRInfinite
        if (this._enabledInfinite) {
            codes.push(`  const utilsForInfinite = {
    generateGetKey: <Data = unknown, Variables = unknown>(
      id: ${config.autogenSWRKey ? 'SWRKeyInterface' : 'string'},
      getKey: ${config.typesPrefix}SWRInfiniteKeyLoader${config.typesSuffix}<Data, Variables>
    ) => (pageIndex: number, previousData: Data | null) => {
      const key = getKey(pageIndex, previousData)
      return key ? [id, ...key] : null
    },
    generateFetcher: <Query = unknown, Variables = unknown>(query: (variables: Variables) => Promise<Query>, variables?: Variables) => (
        id: string,
        fieldName: keyof Variables,
        fieldValue: Variables[typeof fieldName]
      ) => query({ ...variables, [fieldName]: fieldValue } as Variables)
  }`);
        }
        // Add the function for auto-generation key for SWR
        if (config.autogenSWRKey) {
            codes.push(`  const genKey = <V extends Record<string, unknown> = Record<string, unknown>>(name: string, object: V = {} as V): SWRKeyInterface => [name, ...Object.keys(object).sort().map(key => object[key])];`);
        }
        // Add return statement for getSdkWithHooks function and close the function
        codes.push(`  return {
    ...sdk,
${allPossibleActions.join(',\n')}
  };
}`);
        // Add type of Sdk
        codes.push(`export type ${config.typesPrefix}SdkWithHooks${config.typesSuffix} = ReturnType<typeof getSdkWithHooks>;`);
        return codes.join('\n');
    }
}
exports.SWRVisitor = SWRVisitor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlzaXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy92aXNpdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtGQU0rQztBQUMvQyxxQ0FBc0U7QUFDdEUsNERBQTZCO0FBQzdCLDZDQUF3QztBQTJCeEMsTUFBTSxtQkFBbUIsR0FBRyxDQUMxQixTQUFvQixFQUNwQixNQUFpQyxFQUN2QixFQUFFO0lBQ1osTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFBO0lBQzFCLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxTQUFTLENBQUE7SUFDMUIsTUFBTSxpQkFBaUIsR0FDckIsQ0FBQyxJQUFJLENBQUMsbUJBQW1CO1FBQ3pCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUNyQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUM1QixDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssY0FBSSxDQUFDLGFBQWEsSUFBSSxDQUFDLENBQUMsWUFBWSxDQUM1RDtRQUNDLENBQUMsQ0FBQyxHQUFHO1FBQ0wsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUNSLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQzVCLE1BQU0sVUFBVSxHQUFHLElBQUEsd0JBQVUsRUFBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzlDLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxVQUFVO1FBQ3BDLENBQUMsQ0FBQyxrQkFBa0IsU0FBUyxDQUFDLG1CQUFtQixHQUFHO1FBQ3BELENBQUMsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLENBQUE7SUFDakMsTUFBTSxhQUFhLEdBQUcsU0FBUyxDQUFDLHVCQUF1QixDQUFBO0lBRXZELEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxVQUFVLElBQ3pCLE1BQU0sQ0FBQyxV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