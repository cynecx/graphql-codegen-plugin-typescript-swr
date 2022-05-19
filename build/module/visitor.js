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
    codes.push(`use${pascalName}(${config.autogenKey ? '' : 'key: SWRKeyInterface, '}variables?: ${variablesType} | null, config?: SWRConfigInterface<${responseType}, ClientError>) {
  return useSWR<${responseType}, ClientError>(${config.autogenKey
        ? `variables && genKey<${variablesType}>('${pascalName}', variables)`
        : 'key'}, () => sdk.${name}(variables!), config);
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
        this._additionalImports.push(`${typeImport} { ClientError } from 'graphql-request/dist/types';`);
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
      id: string,
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