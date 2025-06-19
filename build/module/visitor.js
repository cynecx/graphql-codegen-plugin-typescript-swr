import { ClientSideBaseVisitor, indentMultiline, } from '@graphql-codegen/visitor-plugin-common';
import { Kind } from 'graphql';
import glob from 'micromatch';
import { pascalCase } from 'pascal-case';
const composeQueryHandler = (operation, config) => {
    const codes = [];
    const { node } = operation;
    const optionalVariables = !node.variableDefinitions ||
        node.variableDefinitions.length === 0 ||
        node.variableDefinitions.every((v) => v.type.kind !== Kind.NON_NULL_TYPE || v.defaultValue)
        ? '?'
        : '';
    const name = node.name.value;
    const pascalName = pascalCase(node.name.value);
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
export class SWRVisitor extends ClientSideBaseVisitor {
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
            return !glob.isMatch(o.node.name.value, config.excludeQueries);
        })
            .map((o) => composeQueryHandler(o, {
            autogenKey: config.autogenSWRKey,
            infinite: this._enabledInfinite &&
                glob.isMatch(o.node.name.value, config.useSWRInfinite),
            rawRequest: config.rawRequest,
            typesPrefix: config.typesPrefix,
            typesSuffix: config.typesSuffix,
        }))
            .reduce((p, c) => p.concat(c), [])
            .map((s) => indentMultiline(s, 2));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlzaXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy92aXNpdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFFTCxxQkFBcUIsRUFDckIsZUFBZSxHQUdoQixNQUFNLHdDQUF3QyxDQUFBO0FBQy9DLE9BQU8sRUFBaUIsSUFBSSxFQUEyQixNQUFNLFNBQVMsQ0FBQTtBQUN0RSxPQUFPLElBQUksTUFBTSxZQUFZLENBQUE7QUFDN0IsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQTJCeEMsTUFBTSxtQkFBbUIsR0FBRyxDQUMxQixTQUFvQixFQUNwQixNQUFpQyxFQUN2QixFQUFFO0lBQ1osTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFBO0lBQzFCLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxTQUFTLENBQUE7SUFDMUIsTUFBTSxpQkFBaUIsR0FDckIsQ0FBQyxJQUFJLENBQUMsbUJBQW1CO1FBQ3pCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUNyQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUM1QixDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLGFBQWEsSUFBSSxDQUFDLENBQUMsWUFBWSxDQUM1RDtRQUNDLENBQUMsQ0FBQyxHQUFHO1FBQ0wsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUNSLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQzVCLE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzlDLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxVQUFVO1FBQ3BDLENBQUMsQ0FBQyxrQkFBa0IsU0FBUyxDQUFDLG1CQUFtQixHQUFHO1FBQ3BELENBQUMsQ0FBQyxTQUFTLENBQUMs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