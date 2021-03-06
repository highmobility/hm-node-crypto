/*
  * The MIT License
  *
  * Copyright (c) 2014- High-Mobility GmbH (https://high-mobility.com)
  *
  * Permission is hereby granted, free of charge, to any person obtaining a copy
  * of this software and associated documentation files (the "Software"), to deal
  * in the Software without restriction, including without limitation the rights
  * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  * copies of the Software, and to permit persons to whom the Software is
  * furnished to do so, subject to the following conditions:
  *
  * The above copyright notice and this permission notice shall be included in
  * all copies or substantial portions of the Software.
  *
  * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  * THE SOFTWARE.
*/
'use strict'
const crypto = require('crypto')

function generateKeys () {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    privateKey: makeSurePrivateKeyIs32(ecdh.getPrivateKey()),
    publicKey: stripPublicKey(ecdh.getPublicKey())
  }
}

function hmac (key, message) {
  return crypto
    .createHmac('sha256', key)
    .update(fill64Blocks(message))
    .digest()
}

function computeSecret (privateKey, publicKey) {
  const keyWithPriv = crypto.createECDH('prime256v1').setPrivateKey(privateKey)
  const fullPublicKey = Buffer.concat([Buffer.from([4]), publicKey])
  return keyWithPriv.computeSecret(fullPublicKey)
}

function keyPairToPem (privateKey, publicKey) {
  publicKey = Buffer.concat([Buffer.from([4]), publicKey])
  const pemSignature = Buffer.from([48, 129, 135, 2, 1, 0, 48, 19, 6, 7, 42, 134, 72, 206, 61, 2, 1, 6, 8, 42, 134, 72, 206, 61, 3, 1, 7, 4, 109, 48, 107, 2, 1, 1, 4, 32])
  const curve = Buffer.from([161, 68, 3, 66, 0])
  const body = Buffer.concat([pemSignature, privateKey, curve, publicKey]).toString('base64')
  return `-----BEGIN PRIVATE KEY-----\n${addLineBreaks(body)}-----END PRIVATE KEY-----\n\n`
}

function publicKeyToPem (publicKey) {
  publicKey = Buffer.concat([Buffer.from([4]), publicKey])
  const pemSignature = Buffer.from([48, 89, 48, 19, 6, 7, 42, 134, 72, 206, 61, 2, 1, 6, 8, 42, 134, 72, 206, 61, 3, 1, 7, 3, 66, 0])
  const body = Buffer.concat([pemSignature, publicKey]).toString('base64')
  return `-----BEGIN PUBLIC KEY-----\n${addLineBreaks(body)}-----END PUBLIC KEY-----\n\n`
}

function sign (message, privateKey, publicKey) {
  const pem = keyPairToPem(privateKey, publicKey)
  message = fill64Blocks(message)
  const signature = crypto.createSign('SHA256').update(message).sign(pem)
  return stripSignature(signature)
}

function verify (message, signature, publicKey) {
  message = fill64Blocks(message)
  const pem = publicKeyToPem(publicKey)
  const verify = crypto.createVerify('SHA256').update(message)
  signature = fillSignature(signature)

  return verify.verify(pem, signature)
}

function encryptDecrypt (message, privateKey, publicKey, nonce) {
  const sessionKeyValue = sessionKey(privateKey, publicKey, nonce)

  const encryptionKey = sessionKeyValue.slice(0, 16)
  const iv = Buffer.concat([nonce.slice(0, 7), nonce])

  const cipher = crypto.createCipheriv('aes-128-ecb', encryptionKey, '').update(iv)
  let cipherWithSizeOfMessage = Buffer.from(cipher)

  while (cipherWithSizeOfMessage.length < message.length) {
    cipherWithSizeOfMessage = Buffer.concat([cipherWithSizeOfMessage, cipher])
  }
  cipherWithSizeOfMessage = cipherWithSizeOfMessage.slice(0, message.length)
  return xor(cipherWithSizeOfMessage, message)
}

function sessionKey (privateKey, publicKey, nonce) {
  return hmac(computeSecret(privateKey, publicKey), nonce)
}

function addLineBreaks (argStr) {
  let str = argStr
  let finalString = ''
  while (str.length > 0) {
    finalString += `${str.substring(0, 64)}\n`
    str = str.substring(64)
  }
  return finalString
}

function fill64Blocks (message) {
  const size = 64
  if (message.length % size === 0) {
    return message
  } else {
    const sizeToFill = size - message.length % size
    return Buffer.concat([message, Buffer.alloc(sizeToFill).fill([0])])
  }
}

function stripSignature (signature) {
  let currentIndex = 3
  const secVrSize = signature[currentIndex]
  const secVr = signature.slice(4, 4 + secVrSize)
  currentIndex += secVrSize + 1
  // signature[currentIndex] === 2
  currentIndex++
  const secVsSize = signature[currentIndex]
  currentIndex++
  const secVs = signature.slice(currentIndex, currentIndex + secVsSize)

  return Buffer.concat([fixSizeTo32(secVr), fixSizeTo32(secVs)])
}

function fillSignature (shortSignature) {
  const vr = prependZeroIfNeeded(shortSignature.slice(0, 32))
  const vs = prependZeroIfNeeded(shortSignature.slice(32, 64))
  const b2 = vr.length
  const b3 = vs.length
  const b1 = 4 + b2 + b3
  return Buffer.concat([Buffer.from([0x30, b1, 0x02, b2]), vr, Buffer.from([0x02, b3]), vs])
}

function prependZeroIfNeeded (bytes) {
  bytes = removeLeftZeros(bytes)
  if ((bytes[0] & 0x80) === 0x80) {
    return Buffer.concat([Buffer.from([0]), bytes])
  } else {
    return bytes
  }
}

function removeLeftZeros (bytes) {
  let i = 0
  let newBytes = bytes
  while (i < bytes.length && newBytes[0] === 0) {
    i++
    newBytes = bytes.slice(i, bytes.length)
  }
  return newBytes
}

function fixSizeTo32 (binary) {
  const size = 32
  if (binary.length === size) {
    return binary
  } else if (binary.length > size) {
    return binary.slice(binary.length - size, binary.length)
  } else {
    const sizeToFill = size - binary.length
    return Buffer.concat([Buffer.alloc(sizeToFill).fill([0]), binary])
  }
}

function stripPublicKey (publicKey) {
  return publicKey.slice(1, publicKey.length)
}

function makeSurePrivateKeyIs32 (privateKey) {
  if (privateKey.length === 31) {
    return Buffer.concat([Buffer.from([0]), privateKey])
  } else {
    return privateKey
  }
}

function xor (a, b) {
  const result = []
  let i = 0
  for (i = 0; i < a.length; i++) {
    result.push(a[i] ^ b[i])
  }
  return Buffer.from(result)
}

module.exports = {
  generateKeys: generateKeys,
  hmac: hmac,
  computeSecret: computeSecret,
  keyPairToPem: keyPairToPem,
  publicKeyToPem: publicKeyToPem,
  sign: sign,
  verify: verify,
  encryptDecrypt: encryptDecrypt,
  sessionKey: sessionKey
}
