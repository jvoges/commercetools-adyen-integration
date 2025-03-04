const _ = require('lodash')
const ctpClientBuilder = require('../ctp')
const makePaymentHandler = require('./make-payment.handler')
const config = require('../config/config')

const ADYEN_PERCENTAGE_MINOR_UNIT = 10000
const KLARNA_DEFAULT_LINE_ITEM_NAME = 'item'
const KLARNA_DEFAULT_SHIPPING_METHOD_DESCRIPTION = 'shipping'

async function execute(paymentObject) {
  const makePaymentRequestObj = JSON.parse(
    paymentObject.custom.fields.makePaymentRequest
  )
  const commercetoolsProjectKey =
    paymentObject.custom.fields.commercetoolsProjectKey
  if (!makePaymentRequestObj.lineItems) {
    const ctpCart = await _fetchMatchingCart(
      paymentObject,
      commercetoolsProjectKey
    )
    if (ctpCart) {
      makePaymentRequestObj.lineItems = createLineItems(paymentObject, ctpCart)
      paymentObject.custom.fields.makePaymentRequest = JSON.stringify(
        makePaymentRequestObj
      )
    }
  }

  return makePaymentHandler.execute(paymentObject)
}

async function _fetchMatchingCart(paymentObject, ctpProjectKey) {
  const ctpConfig = config.getCtpConfig(ctpProjectKey)
  const ctpClient = ctpClientBuilder.get(ctpConfig)
  const { body } = await ctpClient.fetch(
    ctpClient.builder.carts
      .where(`paymentInfo(payments(id="${paymentObject.id}"))`)
      .expand('shippingInfo.shippingMethod')
  )
  return body.results[0]
}

function createLineItems(payment, cart) {
  const lineItems = []
  const locales = _getLocales(cart, payment)

  cart.lineItems.forEach((item) => {
    if (item.taxRate)
      lineItems.push(_createAdyenLineItemFromLineItem(item, locales))
  })

  cart.customLineItems.forEach((item) => {
    if (item.taxRate)
      lineItems.push(_createAdyenLineItemFromCustomLineItem(item, locales))
  })

  const { shippingInfo } = cart
  if (shippingInfo && shippingInfo.taxRate)
    lineItems.push(_createShippingInfoAdyenLineItem(shippingInfo, locales))

  return lineItems
}

function _getLocales(cart, payment) {
  const locales = []
  let paymentLanguage = payment.custom && payment.custom.fields['languageCode']
  if (!paymentLanguage) paymentLanguage = cart.locale
  if (paymentLanguage) locales.push(paymentLanguage)
  return locales
}

function _createAdyenLineItemFromLineItem(ctpLineItem, locales) {
  return {
    id: ctpLineItem.variant.sku,
    quantity: ctpLineItem.quantity,
    description: _localizeOrFallback(
      ctpLineItem.name,
      locales,
      KLARNA_DEFAULT_LINE_ITEM_NAME
    ),
    amountIncludingTax: ctpLineItem.price.value.centAmount,
    taxPercentage: ctpLineItem.taxRate.amount * ADYEN_PERCENTAGE_MINOR_UNIT,
  }
}

function _createAdyenLineItemFromCustomLineItem(ctpLineItem, locales) {
  return {
    id: ctpLineItem.id,
    quantity: ctpLineItem.quantity,
    description: _localizeOrFallback(
      ctpLineItem.name,
      locales,
      KLARNA_DEFAULT_LINE_ITEM_NAME
    ),
    amountIncludingTax: ctpLineItem.money.centAmount,
    taxPercentage: ctpLineItem.taxRate.amount * ADYEN_PERCENTAGE_MINOR_UNIT,
  }
}

function _createShippingInfoAdyenLineItem(shippingInfo, locales) {
  return {
    id: `${shippingInfo.shippingMethodName}`,
    quantity: 1, // always one shipment item so far
    description:
      _getShippingMethodDescription(shippingInfo, locales) ||
      KLARNA_DEFAULT_SHIPPING_METHOD_DESCRIPTION,
    amountIncludingTax: shippingInfo.price.centAmount,
    taxPercentage: shippingInfo.taxRate.amount * ADYEN_PERCENTAGE_MINOR_UNIT,
  }
}

function _getShippingMethodDescription(shippingInfo, locales) {
  const shippingMethod = shippingInfo.shippingMethod?.obj
  if (shippingMethod) {
    return _localizeOrFallback(
      shippingMethod.localizedDescription,
      locales,
      shippingMethod.description
    )
  }
  return shippingInfo.shippingMethodName
}

function _localizeOrFallback(localizedString, locales, fallback) {
  let result
  if (_.size(localizedString) > 0) {
    const locale = locales?.find((l) => localizedString[l])
    result = localizedString[locale] || Object.values(localizedString)[0]
  } else result = fallback
  return result
}

module.exports = { execute }
